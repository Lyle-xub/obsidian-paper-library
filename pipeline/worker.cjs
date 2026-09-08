#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function model(modelRoot, relativePath) {
  return toArrayBuffer(fs.readFileSync(path.join(modelRoot, relativePath)));
}

function blocksFromRegions(regions) {
  return (regions || []).map((region) => ({
    type: region.type || region.label || "unknown",
    label: region.label || region.type || "unknown",
    score: Number(region.score) || 0,
    bbox: Array.isArray(region.bbox) ? region.bbox : [],
    text: (region.ocr || []).map((item) => item.text || "").filter(Boolean).join("\n"),
    formula: region.formula?.formula || "",
    tableHtml: region.table?.matched?.html || region.table?.structure?.html || ""
  }));
}

function boxIou(left, right) {
  const x1 = Math.max(left[0], right[0]);
  const y1 = Math.max(left[1], right[1]);
  const x2 = Math.min(left[2], right[2]);
  const y2 = Math.min(left[3], right[3]);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (!intersection) return 0;
  const leftArea = Math.max(0, left[2] - left[0]) * Math.max(0, left[3] - left[1]);
  const rightArea = Math.max(0, right[2] - right[0]) * Math.max(0, right[3] - right[1]);
  return intersection / Math.max(1, leftArea + rightArea - intersection);
}

function parseLayoutOutput(outputs, labels, threshold = 0.5) {
  const tensor = Object.values(outputs).find((value) => (
    value?.data instanceof Float32Array
    && value.dims?.length >= 2
    && [6, 8].includes(value.dims[value.dims.length - 1])
  ));
  if (!tensor) throw new Error(`Local layout output is unsupported: ${Object.keys(outputs).join(", ")}`);
  const rowWidth = tensor.dims[tensor.dims.length - 1];
  const maximumRows = Math.floor(tensor.data.length / rowWidth);
  const countTensor = Object.values(outputs).find((value) => (
    value !== tensor && value?.data?.length === 1 && Number.isInteger(Number(value.data[0]))
  ));
  const rowCount = Math.min(maximumRows, Number(countTensor?.data?.[0]) || maximumRows);
  const boxes = [];
  for (let row = 0; row < rowCount; row += 1) {
    const offset = row * rowWidth;
    const classId = Number(tensor.data[offset]);
    const score = Number(tensor.data[offset + 1]);
    const coordinate = Array.from(tensor.data.slice(offset + 2, offset + 6));
    if (!Number.isInteger(classId) || score < threshold || coordinate.some((value) => !Number.isFinite(value))) continue;
    if (coordinate[2] <= coordinate[0] || coordinate[3] <= coordinate[1]) continue;
    boxes.push({ classId, score, coordinate, label: labels[classId] || String(classId) });
  }
  const kept = [];
  for (const candidate of boxes.sort((left, right) => right.score - left.score)) {
    if (kept.some((box) => box.classId === candidate.classId && boxIou(box.coordinate, candidate.coordinate) > 0.5)) continue;
    kept.push(candidate);
  }
  return kept;
}

async function main() {
  const selfTest = process.argv.includes("--self-test");
  const inputPath = option("--input");
  const modelRoot = option("--models");
  const outputRoot = option("--output");
  const runtimeRoot = option("--runtime");
  if (!modelRoot || !runtimeRoot || (!selfTest && (!inputPath || !outputRoot))) {
    throw new Error("Usage: worker.cjs --input pages.json --models DIR --runtime DIR --output DIR [--self-test]");
  }

  const ort = require(path.join(runtimeRoot, "node_modules", "onnxruntime-node"));
  const { PaddleStructureService, createFormulaTokenizerVocabulary } = require(
    path.join(runtimeRoot, "node_modules", "paddleocr")
  );
  const input = selfTest ? { pages: [] } : JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const dictionary = fs.readFileSync(path.join(modelRoot, "ocr/ppocrv6_dict.txt"), "utf8")
    .split(/\r?\n/).filter((value) => value.length > 0);
  if (!dictionary.includes(" ")) dictionary.push(" ");
  const layoutConfig = JSON.parse(fs.readFileSync(
    path.join(modelRoot, "layout/config.json"), "utf8"
  ));
  const formulaConfig = JSON.parse(fs.readFileSync(
    path.join(modelRoot, "formula/PP-FormulaNet-plus-M/config.json"), "utf8"
  ));
  const tokenizer = formulaConfig?.PostProcess?.character_dict?.fast_tokenizer_file;
  if (!tokenizer?.model?.vocab) {
    throw new Error("Local formula tokenizer is missing from the model configuration.");
  }
  const fallbackLabels = [
    "abstract", "algorithm", "aside_text", "chart", "content", "display_formula",
    "doc_title", "figure_title", "footer", "footer_image", "footnote", "formula_number",
    "header", "header_image", "image", "inline_formula", "number", "paragraph_title",
    "reference", "reference_content", "seal", "table", "text", "vertical_text", "vision_footnote"
  ];
  const labels = Array.isArray(layoutConfig.label_list) && layoutConfig.label_list.length
    ? layoutConfig.label_list
    : fallbackLabels;
  const pipeline = await PaddleStructureService.createInstance({
    ort,
    layout: {
      modelBuffer: model(modelRoot, "layout/PP-DocLayoutV2.onnx"),
      preset: "PP-DocLayout_plus-L",
      imageHeight: 800,
      imageWidth: 800,
      labels,
      requiredInputNames: ["image", "im_shape", "scale_factor"],
      channelOrder: "bgr",
      mean: [0, 0, 0],
      stdDeviation: [1 / 255, 1 / 255, 1 / 255],
      outputLayout: "class-score-xyxy",
      layoutNms: true,
      threshold: Number(layoutConfig.draw_threshold) || 0.5
    },
    ocr: {
      modelPreset: "PP-OCRv6_small",
      detection: { modelBuffer: model(modelRoot, "ocr/ch_PP-OCRv6_small_det_infer.onnx") },
      recognition: {
        modelBuffer: model(modelRoot, "ocr/ch_PP-OCRv6_small_rec_infer.onnx"),
        charactersDictionary: dictionary,
        outputSelectionStrategy: "ctc-logits"
      }
    },
    tableStructure: { modelBuffer: model(modelRoot, "table/slanet-plus.onnx"), preset: "SLANet" },
    formulaRecognition: {
      modelBuffer: model(modelRoot, "formula/PP-FormulaNet-plus-M/inference.onnx"),
      preset: "PP-FormulaNet_plus-M",
      tokenizerVocabulary: createFormulaTokenizerVocabulary(tokenizer)
    },
    options: {
      documentOrientation: { enabled: false },
      textImageUnwarping: { enabled: false },
      regionDetection: { enabled: false },
      layout: { enabled: true, fallbackRegionType: false },
      readingOrder: { enabled: true },
      ocr: { enabled: true },
      table: { enabled: true },
      formula: { enabled: true },
      seal: { enabled: false },
      markdown: { enabled: true }
    }
  });
  const layoutService = pipeline.services?.layout;
  if (!layoutService?.runRaw) throw new Error("Local layout service was not initialized.");
  pipeline.services.layout = {
    run: async (input, options = {}) => {
      const raw = await layoutService.runRaw(input, options);
      return parseLayoutOutput(raw.outputs, labels, Number(options.threshold) || Number(layoutConfig.draw_threshold) || 0.5);
    }
  };
  if (selfTest) {
    process.stdout.write(JSON.stringify({ ready: true, labels: labels.length, dictionary: dictionary.length }));
    return;
  }

  const pages = [];
  for (const descriptor of input.pages || []) {
    const rgba = fs.readFileSync(path.join(path.dirname(inputPath), descriptor.file));
    if (rgba.byteLength !== descriptor.width * descriptor.height * 4) {
      throw new Error(`Invalid RGBA page buffer: ${descriptor.file}`);
    }
    process.stderr.write(`PAGE ${descriptor.page}/${input.pages.length}\n`);
    const result = await pipeline.run({
      width: descriptor.width,
      height: descriptor.height,
      data: new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength)
    });
    pages.push({
      page: descriptor.page,
      markdown: String(result.markdown?.text || "").trim(),
      blocks: blocksFromRegions(result.regions)
    });
  }

  const payload = {
    engine: "mineru-compatible-no-torch-v2",
    totalPages: Number(input.totalPages) || pages.length,
    pages,
    assetsPath: path.join(outputRoot, "assets")
  };
  fs.mkdirSync(outputRoot, { recursive: true });
  const temporary = path.join(outputRoot, `document.json.${process.pid}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify(payload));
  fs.renameSync(temporary, path.join(outputRoot, "document.json"));
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
