#!/usr/bin/env python3
"""Extract PDF title/figure regions with DocLayout-YOLO ONNX Runtime and PyMuPDF."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
RUNTIME_CACHE = SCRIPT_DIR / ".doclayout-cache"
RUNTIME_CACHE.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", str(RUNTIME_CACHE / "matplotlib"))
os.environ.setdefault("XDG_CACHE_HOME", str(RUNTIME_CACHE))

import pymupdf as fitz  # noqa: E402
import numpy as np  # noqa: E402
import onnxruntime as ort  # noqa: E402
from PIL import Image  # noqa: E402


FIGURE_CAPTION = re.compile(r"^\s*((?:Figure|Fig\.)\s*[A-Z]?\d+[A-Z]?)[.:\s-]*(.*)$", re.I)


def emit_progress(stage: str, current: int, total: int, figures: int) -> None:
    print(
        "PAPERLIB_PROGRESS:" + json.dumps({
            "stage": stage,
            "current": current,
            "total": total,
            "figures": figures,
        }, ensure_ascii=False),
        flush=True,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--dpi", type=int, default=144)
    parser.add_argument("--conf", type=float, default=0.18)
    parser.add_argument("--metadata-only", action="store_true")
    return parser.parse_args()


CLASS_NAMES = {
    0: "title",
    1: "plain text",
    2: "abandon",
    3: "figure",
    4: "figure_caption",
    5: "table",
    6: "table_caption",
    7: "table_footnote",
    8: "isolate_formula",
    9: "formula_caption",
}


def page_image(page: fitz.Page, dpi: int) -> tuple[np.ndarray, float]:
    scale = dpi / 72.0
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False, colorspace=fitz.csRGB)
    rgb = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, 3)
    return rgb.copy(), scale


def prepare_input(image: np.ndarray, image_size: int = 1024) -> tuple[np.ndarray, float, int, int]:
    height, width = image.shape[:2]
    ratio = min(image_size / height, image_size / width)
    resized_width = max(1, int(round(width * ratio)))
    resized_height = max(1, int(round(height * ratio)))
    resampling = getattr(Image, "Resampling", Image).BILINEAR
    resized = np.asarray(Image.fromarray(image).resize((resized_width, resized_height), resampling))
    left = int(round((image_size - resized_width) / 2 - 0.1))
    top = int(round((image_size - resized_height) / 2 - 0.1))
    canvas = np.full((image_size, image_size, 3), 114, dtype=np.uint8)
    canvas[top:top + resized_height, left:left + resized_width] = resized
    tensor = np.ascontiguousarray(canvas.transpose(2, 0, 1)[None], dtype=np.float32) / 255.0
    return tensor, ratio, left, top


def create_session(model_path: Path) -> tuple[ort.InferenceSession, str]:
    """Create a predictable desktop inference session.

    CoreML 1.19 may accept this exported model during capability discovery and
    then fail while compiling its temporary MLProgram on macOS. That leaves the
    Obsidian extraction job without an index. CPU execution is fast enough for
    this page-at-a-time workflow and is consistent across desktop platforms.
    """
    options = ort.SessionOptions()
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.intra_op_num_threads = max(1, min(4, os.cpu_count() or 2))
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(
        str(model_path),
        sess_options=options,
        providers=["CPUExecutionProvider"],
    )
    return session, "onnx-cpu"


def predict(session: ort.InferenceSession, image: np.ndarray, confidence: float):
    tensor, ratio, left, top = prepare_input(image)
    input_name = session.get_inputs()[0].name
    predictions = session.run(None, {input_name: tensor})[0]
    if predictions.ndim == 3:
        predictions = predictions[0]
    height, width = image.shape[:2]
    detections = []
    for row in predictions:
        score = float(row[4])
        class_id = int(round(float(row[5])))
        class_name = CLASS_NAMES.get(class_id)
        if score < confidence or not class_name:
            continue
        x0, y0, x1, y1 = (float(value) for value in row[:4])
        x0 = np.clip((x0 - left) / ratio, 0, width)
        y0 = np.clip((y0 - top) / ratio, 0, height)
        x1 = np.clip((x1 - left) / ratio, 0, width)
        y1 = np.clip((y1 - top) / ratio, 0, height)
        detections.append((float(x0), float(y0), float(x1), float(y1), score, class_name))
    return detections


def caption_for_box(page: fitz.Page, box: tuple[float, float, float, float], scale: float) -> tuple[str, str]:
    x0, y0, x1, y1 = (value / scale for value in box)
    candidates = []
    for block in page.get_text("blocks"):
        bx0, by0, bx1, by1, text = block[:5]
        match = FIGURE_CAPTION.match(str(text).replace("\n", " ").strip())
        if not match or by0 < y1 - 4 or by0 > y1 + 620:
            continue
        horizontal_overlap = max(0.0, min(x1, bx1) - max(x0, bx0))
        if horizontal_overlap <= 0 and abs(bx0 - x0) > 80:
            continue
        candidates.append((by0 - y1, match.group(1), match.group(2).strip()))
    if not candidates:
        return "", ""
    _, label, caption = min(candidates, key=lambda item: item[0])
    return re.sub(r"^Fig\.\s*", "Figure ", label, flags=re.I), caption


def text_for_box(page: fitz.Page, box: tuple[float, float, float, float], scale: float) -> str:
    x0, y0, x1, y1 = (value / scale for value in box)
    text = page.get_text("text", clip=fitz.Rect(x0, y0, x1, y1), sort=True)
    text = re.sub(r"([A-Za-z])-\s*\n\s*([A-Za-z])", r"\1-\2", str(text))
    return re.sub(r"\s+", " ", text).strip()


def remove_nested_boxes(detections):
    kept = []
    for detection in sorted(detections, key=lambda item: (item[2] - item[0]) * (item[3] - item[1]), reverse=True):
        x0, y0, x1, y1, _ = detection
        area = max(1, (x1 - x0) * (y1 - y0))
        nested = False
        for outer in kept:
            ox0, oy0, ox1, oy1, _ = outer
            intersection = max(0, min(x1, ox1) - max(x0, ox0)) * max(0, min(y1, oy1) - max(y0, oy0))
            outer_area = max(1, (ox1 - ox0) * (oy1 - oy0))
            if intersection / area > 0.88 and outer_area > area * 1.35:
                nested = True
                break
        if not nested:
            kept.append(detection)
    return sorted(kept, key=lambda item: (item[1], item[0]))


def main() -> int:
    args = parse_args()
    pdf_path = Path(args.pdf).resolve()
    model_path = Path(args.model).resolve()
    output_dir = Path(args.output).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    for old_crop in output_dir.glob("figure-*.png"):
        old_crop.unlink(missing_ok=True)

    document = fitz.open(pdf_path)
    total_pages = document.page_count
    figures = []
    title_candidates = []
    sequence = 0
    processing_pages = min(total_pages, 2) if args.metadata_only else total_pages
    emit_progress("model", 0, processing_pages, 0)
    session, device = create_session(model_path)

    for page_index in range(processing_pages):
        page = document.load_page(page_index)
        image, scale = page_image(page, args.dpi)
        height, width = image.shape[:2]
        predictions = predict(session, image, args.conf)
        if page_index < 2:
            for x0, y0, x1, y1, confidence, class_name in predictions:
                if class_name != "title":
                    continue
                # DocLayout boxes can tightly clip the first/last glyphs of a
                # long centered title. Expand horizontally before asking
                # PyMuPDF for the text, while keeping the vertical band narrow
                # enough to exclude authors and headers.
                title_padding_x = min(220.0, max(28.0, width * 0.16))
                title_padding_y = min(28.0, max(8.0, height * 0.012))
                title_text = text_for_box(page, (
                    max(0.0, x0 - title_padding_x),
                    max(0.0, y0 - title_padding_y),
                    min(float(width), x1 + title_padding_x),
                    min(float(height), y1 + title_padding_y),
                ), scale)
                if len(title_text) < 5 or len(title_text) > 500:
                    continue
                normalized = re.sub(r"[^\w\u4e00-\u9fff]+", "", title_text, flags=re.UNICODE).casefold()
                if not normalized or any(item["normalized"] == normalized for item in title_candidates):
                    continue
                title_candidates.append({
                    "text": title_text,
                    "normalized": normalized,
                    "pageNumber": page_index + 1,
                    "pageWidth": width,
                    "pageHeight": height,
                    "x": int(round(x0)),
                    "y": int(round(y0)),
                    "width": int(round(x1 - x0)),
                    "height": int(round(y1 - y0)),
                    "confidence": round(float(confidence), 4),
                })
        detections = []
        for x0, y0, x1, y1, confidence, class_name in predictions:
            if args.metadata_only:
                continue
            if class_name != "figure":
                continue
            padding = max(6, min(18, int(min(x1 - x0, y1 - y0) * 0.018)))
            x0 = max(0, int(round(x0)) - padding)
            y0 = max(0, int(round(y0)) - padding)
            x1 = min(width, int(round(x1)) + padding)
            y1 = min(height, int(round(y1)) + padding)
            if x1 - x0 < 30 or y1 - y0 < 24:
                continue
            detections.append((x0, y0, x1, y1, float(confidence)))

        detections = remove_nested_boxes(detections)
        grouped = {}
        for detection_index, (x0, y0, x1, y1, confidence) in enumerate(detections):
            label, caption = caption_for_box(page, (x0, y0, x1, y1), scale)
            group_key = label.casefold() if label else f"unlabeled:{detection_index}"
            grouped.setdefault(group_key, {"boxes": [], "label": label, "caption": caption})["boxes"].append(
                (x0, y0, x1, y1, confidence)
            )

        for group in grouped.values():
            boxes_in_group = group["boxes"]
            x0 = min(item[0] for item in boxes_in_group)
            y0 = min(item[1] for item in boxes_in_group)
            x1 = max(item[2] for item in boxes_in_group)
            y1 = max(item[3] for item in boxes_in_group)
            confidence = max(item[4] for item in boxes_in_group)
            sequence += 1
            label = group["label"] or f"Figure {sequence}"
            caption = group["caption"]
            crop_path = output_dir / f"figure-{sequence:04d}-p{page_index + 1}.png"
            Image.fromarray(image[y0:y1, x0:x1]).save(crop_path, format="PNG", compress_level=4)
            figures.append({
                "figureKey": f"doclayout:{page_index + 1}:{sequence}",
                "source": "doclayout-yolo-onnx",
                "pageNumber": page_index + 1,
                "pageWidth": width,
                "pageHeight": height,
                "x": x0,
                "y": y0,
                "width": x1 - x0,
                "height": y1 - y0,
                "confidence": round(confidence, 4),
                "label": label,
                "caption": caption,
                "cropPath": str(crop_path),
            })
        emit_progress("page", page_index + 1, processing_pages, len(figures))

    document.close()
    payload = {
        "engine": "doclayout-yolo-onnx",
        "device": device,
        "totalPages": total_pages,
        "pageCount": len({item["pageNumber"] for item in figures}),
        "titleCandidates": [
            {key: value for key, value in item.items() if key != "normalized"}
            for item in sorted(title_candidates, key=lambda item: (-item["confidence"], item["pageNumber"], item["y"]))
        ],
        "figures": figures,
    }
    manifest_path = output_dir / ("metadata.json" if args.metadata_only else "figures.json")
    manifest_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    emit_progress("complete", processing_pages, processing_pages, len(figures))
    print("PAPERLIB_JSON:" + json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
