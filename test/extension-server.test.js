/* 浏览器扩展桥接服务端到端测试：真实启动插件内的 127.0.0.1 HTTP 服务，
   用 fetch 模拟浏览器扩展调用，验证鉴权、PDF 导入、查重与纯元数据导入。
   运行：node test/extension-server.test.js */
const assert = require("node:assert");
const Module = require("node:module");

const notices = [];
const obsidianMock = {
  ItemView: class {}, Menu: class {}, Modal: class {},
  Plugin: class {}, PluginSettingTab: class {}, Setting: class {},
  Notice: class {
    constructor(message) { notices.push(String(message)); }
    setMessage() {} hide() {}
  },
  normalizePath: (p) => String(p).replace(/\\/g, "/"),
  setIcon: () => {},
  requestUrl: async () => { throw new Error("requestUrl not stubbed in test"); }
};
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "obsidian") return obsidianMock;
  return originalLoad.call(this, request, parent, isMain);
};
const PaperLibraryPlugin = require("../main.js");
Module._load = originalLoad;

const PORT = 24567;
const PDF_BYTES = Buffer.from("%PDF-1.7 fake pdf body for tests\n%%EOF\n");

function makePlugin() {
  const plugin = Object.create(PaperLibraryPlugin.prototype);
  plugin.settings = {
    papers: [],
    tags: [],
    extensionServerEnabled: true,
    extensionServerPort: PORT,
    extensionToken: "test-token-123"
  };
  plugin.isMobileApp = () => false;
  plugin.app = { vault: { getAbstractFileByPath: (path) => path ? { path } : null } };
  plugin.saveSettings = async () => {};
  plugin.refreshViews = () => {};
  plugin.importPdfBatchCalls = [];
  plugin.importPdfBatch = async (files, hints) => {
    plugin.importPdfBatchCalls.push({ files, hints });
    const buffer = await files[0].arrayBuffer();
    const head = Buffer.from(buffer.slice(0, 5)).toString("latin1");
    assert.strictEqual(head, "%PDF-", "importPdfBatch 应收到原始 PDF 字节");
    return { imported: 1, failed: 0 };
  };
  return plugin;
}

async function api(path, { method = "GET", token = "test-token-123", body } = {}) {
  const response = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

(async () => {
  const plugin = makePlugin();
  plugin.startExtensionServer();
  assert.ok(plugin.extensionServer, "服务应已启动");
  await new Promise((resolve) => plugin.extensionServer.on("listening", resolve));

  try {
    // 1. 无令牌 / 错令牌 → 401
    let res = await api("/api/ping", { token: null });
    assert.strictEqual(res.status, 401, "无令牌应 401");
    res = await api("/api/ping", { token: "wrong" });
    assert.strictEqual(res.status, 401, "错令牌应 401");

    // 2. ping 正常
    res = await api("/api/ping");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
    assert.strictEqual(res.data.papers, 0);

    // 3. 查询当前页面是否已在库中，并返回本地缓存的数据卡片
    res = await api("/api/lookup", {
      method: "POST",
      body: { metadata: { title: "Not Imported Yet", doi: "10.1/missing" } }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.found, false);
    plugin.settings.papers.push({
      id: "local-metrics", title: "Local Metrics Paper", doi: "10.1/local", authors: ["Ada Lovelace"],
      year: 2025, venue: "Nature", venueRanks: [{ system: "JCR", rank: "Q1" }, { system: "IF 2025", rank: "50.5" }],
      metrics: { status: "ready", citations: 12, references: 34, type: "期刊论文", source: "Semantic Scholar" },
      tags: ["AI"], collections: ["Reading"], rating: 4, pdfPath: "Papers/local.pdf"
    });
    res = await api("/api/lookup", {
      method: "POST",
      body: { metadata: { title: "Local Metrics Paper", doi: "10.1/local" } }
    });
    assert.strictEqual(res.data.found, true);
    assert.strictEqual(res.data.paper.citations, 12);
    assert.strictEqual(res.data.paper.references, 34);
    assert.ok(res.data.paper.venueRanks.some((rank) => rank.system === "IF 2025"));
    assert.strictEqual(res.data.paper.hasPdf, true);

    // 4. base64 PDF 导入 → 走 importPdfBatch，附带元数据 hints
    res = await api("/api/import", {
      method: "POST",
      body: {
        metadata: { title: "Attention Is All You Need", doi: "10.1/test", authors: ["Vaswani"], year: 2017 },
        pdfBase64: PDF_BYTES.toString("base64"),
        fileName: "attention.pdf"
      }
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.strictEqual(res.data.ok, true);
    assert.strictEqual(res.data.duplicate, false);
    assert.strictEqual(plugin.importPdfBatchCalls.length, 1, "应调用 importPdfBatch");
    assert.strictEqual(plugin.importPdfBatchCalls[0].files[0].name, "attention.pdf");
    assert.strictEqual(plugin.importPdfBatchCalls[0].hints[0].doi, "10.1/test");

    // 5. 同 DOI 再导入 → 查重命中（先把论文放进库里）
    plugin.settings.papers.push({ id: "p1", title: "Attention Is All You Need", doi: "10.1/test", arxiv: "", pdfPath: "Papers/attention.pdf" });
    res = await api("/api/import", {
      method: "POST",
      body: { metadata: { title: "Attention Is All You Need", doi: "10.1/test" }, pdfBase64: PDF_BYTES.toString("base64") }
    });
    assert.strictEqual(res.data.ok, true);
    assert.strictEqual(res.data.duplicate, true, "同 DOI 应判定重复");
    assert.strictEqual(plugin.importPdfBatchCalls.length, 1, "重复论文不应再次导入");

    // 6. 非 PDF 内容 → needsLogin 错误
    res = await api("/api/import", {
      method: "POST",
      body: { metadata: { title: "Paywalled Paper" }, pdfBase64: Buffer.from("<html>login</html>").toString("base64") }
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.needsLogin, true, "非 PDF 内容应提示需要登录");

    // 7. 纯元数据导入（拿不到全文时）
    res = await api("/api/import", {
      method: "POST",
      body: { metadata: { title: "Metadata Only Paper", authors: ["Doe"], year: 2024, venue: "Nature" } }
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.strictEqual(res.data.metadataOnly, true);
    const added = plugin.settings.papers.find((p) => p.title === "Metadata Only Paper");
    assert.ok(added, "纯元数据论文应已入库");
    assert.deepStrictEqual(added.authors, ["Doe"]);
    assert.strictEqual(added.importStatus, undefined, "纯元数据导入不应停留在导入中状态");

    // 8. 未知路径 → 404；OPTIONS 预检无需令牌
    res = await api("/api/nope");
    assert.strictEqual(res.status, 404);
    const preflight = await fetch(`http://127.0.0.1:${PORT}/api/import`, { method: "OPTIONS" });
    assert.ok([200, 204].includes(preflight.status), "OPTIONS 预检应放行");

    // 9. chrome.downloads 落盘文件导入（filePath 通道）
    const fs = require("node:fs");
    const os = require("node:os");
    const nodePath = require("node:path");
    const downloadsFile = nodePath.join(os.homedir(), "Downloads", `paperlib-test-${Date.now()}.pdf`);
    fs.writeFileSync(downloadsFile, PDF_BYTES);
    res = await api("/api/import", {
      method: "POST",
      body: { metadata: { title: "Downloaded Via Browser", doi: "10.1/browser" }, filePath: downloadsFile, cleanup: true }
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.strictEqual(res.data.ok, true);
    assert.strictEqual(plugin.importPdfBatchCalls.length, 2, "filePath 通道应触发 importPdfBatch");
    assert.ok(!fs.existsSync(downloadsFile), "cleanup 后临时下载文件应被删除");

    // 10. Downloads 目录外的路径必须被拒绝
    res = await api("/api/import", {
      method: "POST",
      body: { metadata: { title: "Evil" }, filePath: "/etc/hosts" }
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.data.error, /目录/, "目录外路径应被拒绝");

    console.log("Extension server tests passed (10/10)");
  } finally {
    plugin.stopExtensionServer();
    assert.strictEqual(plugin.extensionServer, null, "服务应已停止");
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
