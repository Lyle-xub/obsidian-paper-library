/* 引用模板引擎回归测试：以 Scholar Sidekick 在线 API 的输出作为基准（fixtures/citation/*.json），
   对比本地引擎在相同元数据下的渲染结果。
   运行：node test/citation-engine.test.js */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const obsidianMock = {
  ItemView: class {}, Menu: class {}, Modal: class {}, Notice: class {},
  Plugin: class {}, PluginSettingTab: class {}, Setting: class {},
  normalizePath: (p) => String(p).replace(/\\/g, "/"),
  setIcon: () => {}
};
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "obsidian") return obsidianMock;
  return originalLoad.call(this, request, parent, isMain);
};
const PaperLibraryPlugin = require("../main.js");
Module._load = originalLoad;

const FIXTURES = path.join(__dirname, "fixtures", "citation");

function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));
}

// 把 /api/lookup 的规范化记录转换成插件的 paper 结构
function paperFromLookup(file) {
  const record = loadJson(file).result;
  const container = record.container || {};
  const doi = (record.identifiers || []).find((id) => id.type === "doi")?.value || "";
  const arxiv = (record.identifiers || []).find((id) => id.type === "arxiv")?.value
    || (record.id || "").replace(/^arxiv:/, "");
  return {
    title: record.title || "",
    authors: (record.authors || []).map((a) => a.literal || `${a.family}, ${a.given}`.replace(/,\s*$/, "")),
    year: record.issued?.year || 0,
    venue: container.title || "",
    journalAbbreviation: container.abbreviated || "",
    volume: container.volume ? String(container.volume) : "",
    issue: container.issue ? String(container.issue) : "",
    pages: record.pages?.first ? `${record.pages.first}-${record.pages.last || ""}`.replace(/-$/, "") : "",
    doi,
    arxiv: record.type === "report" || !doi ? arxiv : ""
  };
}

const PAPERS = [
  paperFromLookup("lookup_10_1038_nphys1170.json"),
  paperFromLookup("lookup_10_1056_NEJMoa2033700.json"),
  paperFromLookup("lookup_arXiv_1706_03762.json")
];

// API style id → 本地样式 id
const STYLE_MAP = {
  apa: "apa-7",
  ieee: "ieee",
  vancouver: "vancouver",
  ama: "ama",
  nature: "nature",
  science: "science",
  cell: "cell",
  "american-chemical-society": "american-chemical-society",
  "chicago-author-date": "chicago-author-date",
  "modern-language-association": "mla-9",
  "harvard-cite-them-right": "harvard"
};

// 已知的合理差异（在线输出本身的小瑕疵或输入形态差异）
const KNOWN_DIVERGENCES = {
  "vancouver:2": "在线 Vancouver 对无期刊论文输出悬空的“;.”，本地已修正；arXiv 作者为字面名（见下）",
  "ama:2": "在线 AMA 对无期刊论文输出悬空的“;.”，本地已修正；arXiv 作者为字面名（见下）",
  "modern-language-association:2": "MLA 需要完整出版日期（12 Jun. 2017），本地只有年份；arXiv 作者为字面名（见下）",
  "apa:2": "arXiv 元数据的作者是不可拆分字面名（“Vaswani, Ashish”），在线原样保留；本地按可拆分姓名正确缩写",
  "ieee:2": "arXiv 字面名差异（同上）",
  "nature:2": "arXiv 字面名差异（同上）",
  "science:2": "arXiv 字面名差异（同上）",
  "cell:2": "arXiv 字面名差异（同上）",
  "american-chemical-society:2": "arXiv 字面名差异（同上）",
  "chicago-author-date:2": "arXiv 字面名差异（同上）",
  "harvard-cite-them-right:2": "arXiv 字面名差异（同上）"
};

const plugin = Object.create(PaperLibraryPlugin.prototype);
plugin.settings = { customCitationStyles: [] };
plugin.uiState = { exportStyle: "apa-7" };

let pass = 0;
let diff = 0;
let known = 0;
for (const [apiStyle, localStyle] of Object.entries(STYLE_MAP)) {
  const reference = loadJson(`${apiStyle}.json`);
  const expectedLines = String(reference.text || "").split("\n").filter((line) => line.trim());
  PAPERS.forEach((paper, index) => {
    // 去掉参考文献列表的编号前缀（本地单条复制不含编号）
    const expected = (expectedLines[index] || "").replace(/^\s*(?:\(\d+\)|\d+\.)\s+/, "").trim();
    const actual = plugin.formatCitation(paper, localStyle);
    const key = `${apiStyle}:${index}`;
    if (actual === expected) {
      pass += 1;
    } else if (KNOWN_DIVERGENCES[key]) {
      known += 1;
      console.log(`≈ [${apiStyle}] 论文${index + 1}（已知差异：${KNOWN_DIVERGENCES[key]}）`);
      console.log(`  在线: ${expected}`);
      console.log(`  本地: ${actual}`);
    } else {
      diff += 1;
      console.log(`✗ [${apiStyle}] 论文${index + 1}`);
      console.log(`  在线: ${expected}`);
      console.log(`  本地: ${actual}`);
    }
  });
}
console.log(`\n结果：${pass} 完全一致，${known} 已知差异，${diff} 待修复差异`);

/* ---------- 第二部分：CSL 解析器冒烟测试 ----------
   验证"在线模板 → 本地模板"的导入路径：解析官方 CSL XML（与 Scholar Sidekick 同源），
   用解析出的模板渲染并打印，供人工抽查。解析是近似实现，不做严格断言。 */
console.log("\n========== CSL 导入解析（近似，供抽查） ==========");
const { parseCslStyleToTemplate, renderCitationTemplate, citationFieldBag } = PaperLibraryPlugin.citationInternals;
const CSL_DIR = path.join(FIXTURES, "csl");
for (const file of fs.readdirSync(CSL_DIR).filter((name) => name.endsWith(".csl"))) {
  const id = file.replace(/\.csl$/, "");
  try {
    const parsed = parseCslStyleToTemplate(fs.readFileSync(path.join(CSL_DIR, file), "utf8"), id);
    if (parsed.dependent) {
      console.log(`- ${id}: 依赖样式 → ${parsed.parent || "?"}`);
      continue;
    }
    const sample = renderCitationTemplate(parsed, citationFieldBag(PAPERS[0]));
    console.log(`- ${id} → ${parsed.label}`);
    console.log(`  模板: ${parsed.template}`);
    console.log(`  示例: ${sample}`);
    if (parsed.warnings?.length) console.log(`  警告: ${parsed.warnings.join("；")}`);
  } catch (error) {
    console.log(`✗ ${id}: ${error.message}`);
    diff += 1;
  }
}
process.exit(diff ? 1 : 0);
