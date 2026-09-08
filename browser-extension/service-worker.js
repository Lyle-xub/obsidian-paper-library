// Paper Library Web Importer — Manifest V3 service worker
// Coordinates detection, authenticated PDF downloads and the loopback bridge.

"use strict";

const DEFAULT_PORT = 23987;
const S2_BASE = "https://api.semanticscholar.org/graph/v1";

async function config() {
  const stored = await chrome.storage.local.get(["paperlibToken", "paperlibPort"]);
  return {
    token: String(stored.paperlibToken || "").trim(),
    port: Math.min(65535, Math.max(1024, Number(stored.paperlibPort) || DEFAULT_PORT))
  };
}

const endpoint = (settings, path) => `http://127.0.0.1:${settings.port}${path}`;

async function responseJson(response) {
  return response.json().catch(() => ({}));
}

async function ping(settings) {
  const response = await fetch(endpoint(settings, "/api/ping"), {
    headers: { Authorization: `Bearer ${settings.token}` }
  });
  return { status: response.status, data: await responseJson(response) };
}

async function postJson(settings, path, payload) {
  const response = await fetch(endpoint(settings, path), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  return { status: response.status, data: await responseJson(response) };
}

async function postPdf(settings, metadata, fileName, pdfBuffer) {
  const json = new TextEncoder().encode(JSON.stringify({ metadata, fileName }));
  const header = new Uint8Array(4);
  new DataView(header.buffer).setUint32(0, json.byteLength, false);
  const response = await fetch(endpoint(settings, "/api/import-pdf"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.token}`,
      "Content-Type": "application/x-paperlib-import"
    },
    body: new Blob([header, json, pdfBuffer])
  });
  return { status: response.status, data: await responseJson(response) };
}

function metadataFrom(info = {}) {
  return {
    title: String(info.title || "").trim(),
    authors: Array.isArray(info.authors) ? info.authors.map(String).filter(Boolean) : [],
    year: Number(info.year) || 0,
    venue: String(info.venue || "").trim(),
    journalAbbreviation: String(info.journalAbbreviation || "").trim(),
    volume: String(info.volume || "").trim(),
    issue: String(info.issue || "").trim(),
    pages: String(info.pages || "").trim(),
    abstract: String(info.abstract || "").trim(),
    doi: String(info.doi || "").trim(),
    arxiv: String(info.arxiv || "").trim(),
    source: `浏览器扩展（${info.site || "网页"}）`
  };
}

function safeFileName(info, pdfUrl) {
  try {
    const leaf = decodeURIComponent(new URL(pdfUrl).pathname.split("/").pop() || "");
    if (/\.pdf$/i.test(leaf) && leaf.length > 4) return leaf.slice(0, 180);
  } catch (_) { /* use title */ }
  const title = String(info?.title || "paper")
    .replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 150);
  return `${title || "paper"}.pdf`;
}

function normalizePublisherPdfUrl(value, info = {}) {
  const original = String(value || "");
  if (!original) return "";
  try {
    const url = new URL(original);
    if (/^(?:www\.)?ieeexplore\.ieee\.org$/i.test(url.hostname)) {
      let sourceUrl = null;
      try { sourceUrl = new URL(String(info?.url || "")); } catch (_) { /* ignore */ }
      const articleNumber = url.searchParams.get("arnumber")
        || url.pathname.match(/\/document\/(\d+)/i)?.[1]
        || sourceUrl?.pathname.match(/\/document\/(\d+)/i)?.[1];
      if (articleNumber && (/\/stamp\/stamp\.jsp/i.test(url.pathname)
        || /\/document\/\d+/i.test(url.pathname))) {
        return `https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?tp=&arnumber=${articleNumber}&ref=`;
      }
    }
  } catch (_) { /* return original */ }
  return original;
}

function isIeeePdfUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.hostname === "ieeexplore.ieee.org"
      && /\/stampPDF\/getPDF\.jsp/i.test(url.pathname);
  } catch (_) { return false; }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function warmPdfNavigation(url) {
  // IEEE's AWS WAF allows the same URL as a top-level navigation after the
  // institution session is established, but can reject extension fetch/XHR.
  // Load it once in an inactive tab so its challenge and redirect execute in
  // the real browser context, then retry the binary download.
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      };
      const onUpdated = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === "complete") finish();
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      setTimeout(finish, 12000);
    });
    await delay(900);
    return true;
  } catch (_) {
    return false;
  } finally {
    if (tab?.id) chrome.tabs.remove(tab.id).catch(() => undefined);
  }
}

function isPdf(buffer) {
  if (!buffer || buffer.byteLength < 5) return false;
  return String.fromCharCode(...new Uint8Array(buffer.slice(0, 5))) === "%PDF-";
}

function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

async function fetchPdfFromPage(tabId, url) {
  if (!tabId) return null;
  try {
    const reply = await chrome.tabs.sendMessage(tabId, { type: "paperlib:fetch-pdf", url });
    if (reply?.ok && reply.base64) return { kind: "pdf", buffer: fromBase64(reply.base64) };
    if (reply?.reason === "needs-login") return { kind: "needs-login", status: reply.status };
    return { kind: "unavailable", status: reply?.status, error: reply?.error };
  } catch (_) {
    return null;
  }
}

async function fetchPdfFromWorker(url) {
  try {
    const response = await fetch(url, { credentials: "include", redirect: "follow" });
    if (response.status === 401 || response.status === 403) {
      return { kind: "needs-login", status: response.status };
    }
    if (!response.ok) return { kind: "unavailable", status: response.status };
    const buffer = await response.arrayBuffer();
    if (isPdf(buffer)) return { kind: "pdf", buffer };
    const contentType = String(response.headers.get("content-type") || "");
    return /html/i.test(contentType)
      ? { kind: "needs-login", contentType }
      : { kind: "unavailable", contentType };
  } catch (error) {
    return { kind: "unavailable", error: String(error?.message || error) };
  }
}

function startBrowserDownload(url) {
  return new Promise((resolve) => {
    let id = null;
    let settled = false;
    const timeout = setTimeout(() => finish({ kind: "unavailable", error: "下载超时" }), 120000);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      chrome.downloads.onChanged.removeListener(onChanged);
      resolve(result);
    };
    const onChanged = (delta) => {
      if (id === null || delta.id !== id) return;
      if (delta.state?.current === "complete") finish({ kind: "download", id });
      if (delta.state?.current === "interrupted") {
        finish({ kind: "unavailable", error: delta.error?.current || "下载被中断" });
      }
    };
    chrome.downloads.onChanged.addListener(onChanged);
    chrome.downloads.download({ url, saveAs: false, conflictAction: "uniquify" }, (downloadId) => {
      if (chrome.runtime.lastError || downloadId === undefined) {
        finish({ kind: "unavailable", error: chrome.runtime.lastError?.message || "浏览器下载失败" });
        return;
      }
      id = downloadId;
    });
  });
}

function searchDownloads(query) {
  return new Promise((resolve, reject) => {
    chrome.downloads.search(query, (items) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(items || []);
    });
  });
}

async function downloadPdfAsBrowserNavigation(url) {
  const result = await startBrowserDownload(url);
  if (result.kind !== "download") return result;
  try {
    const item = (await searchDownloads({ id: result.id }))[0];
    if (!item?.filename) return { kind: "unavailable", error: "找不到浏览器下载文件" };
    return {
      kind: "file",
      path: item.filename,
      fileName: item.filename.split(/[\\/]/).pop() || "paper.pdf"
    };
  } catch (error) {
    return { kind: "unavailable", error: String(error?.message || error) };
  }
}

function s2Identifier(info) {
  if (info?.arxiv) return `ARXIV:${String(info.arxiv).replace(/^arxiv:/i, "")}`;
  if (info?.doi) return `DOI:${info.doi}`;
  return "";
}

async function semanticScholarRequest(path, params) {
  const query = new URLSearchParams(params || {}).toString();
  const response = await fetch(`${S2_BASE}${path}${query ? `?${query}` : ""}`);
  if (!response.ok) return null;
  return responseJson(response);
}

function decodeXmlText(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ").trim();
}

function titleTokens(value) {
  return new Set(String(value || "").toLocaleLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim().split(/\s+/).filter((token) => token.length > 1));
}

function titleSimilarity(left, right) {
  const a = titleTokens(left);
  const b = titleTokens(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  a.forEach((token) => { if (b.has(token)) shared += 1; });
  return (2 * shared) / (a.size + b.size);
}

async function discoverArxivPdfByTitle(title) {
  if (!title) return "";
  try {
    const query = new URLSearchParams({
      search_query: `ti:"${title}"`,
      start: "0",
      max_results: "5"
    });
    const response = await fetch(`https://export.arxiv.org/api/query?${query}`);
    if (!response.ok) return "";
    const xml = await response.text();
    let best = null;
    for (const block of xml.match(/<entry>[\s\S]*?<\/entry>/g) || []) {
      const candidateTitle = decodeXmlText(block.match(/<title>([\s\S]*?)<\/title>/i)?.[1]);
      const id = decodeXmlText(block.match(/<id>([\s\S]*?)<\/id>/i)?.[1])
        .match(/arxiv\.org\/abs\/([^?#\s]+)/i)?.[1];
      const score = titleSimilarity(title, candidateTitle);
      if (id && score >= 0.82 && (!best || score > best.score)) best = { id, score };
    }
    return best ? `https://arxiv.org/pdf/${best.id}` : "";
  } catch (_) {
    return "";
  }
}

async function discoverOpenAccessPdf(info) {
  const fields = "title,externalIds,openAccessPdf";
  const pdfFromPaper = (paper) => {
    if (paper?.openAccessPdf?.url) return paper.openAccessPdf.url;
    const arxiv = String(paper?.externalIds?.ArXiv || "").trim();
    return arxiv ? `https://arxiv.org/pdf/${arxiv}` : "";
  };
  const identifier = s2Identifier(info);
  if (identifier) {
    const paper = await semanticScholarRequest(`/paper/${encodeURIComponent(identifier)}`, { fields });
    const pdf = pdfFromPaper(paper);
    if (pdf) return pdf;
  }
  if (!info?.title) return "";
  const response = await semanticScholarRequest("/paper/search/match", { query: info.title, fields });
  const paper = Array.isArray(response?.data) ? response.data[0] : response;
  return pdfFromPaper(paper) || discoverArxivPdfByTitle(info.title);
}

function normalizeServerResult(status, data) {
  if (data?.ok) return {
    ok: true,
    duplicate: Boolean(data.duplicate),
    attachedPdf: Boolean(data.attachedPdf),
    metadataOnly: Boolean(data.metadataOnly),
    title: data.title || ""
  };
  if (data?.needsLogin) return { ok: false, code: "needs-login", error: data.error || "请登录出版商网站后重试" };
  return { ok: false, code: status === 401 ? "bad-token" : "server", error: data?.error || `导入失败（HTTP ${status}）` };
}

async function requireBridge() {
  const settings = await config();
  if (!settings.token) {
    return { error: { ok: false, code: "no-token", error: "尚未配置 Token，请先连接 Obsidian。" } };
  }
  try {
    const result = await ping(settings);
    if (result.status === 401) return { error: { ok: false, code: "bad-token", error: "Token 无效，请重新从 Obsidian 设置中复制。" } };
    if (!result.data?.ok) return { error: { ok: false, code: "offline", error: result.data?.error || "Obsidian 导入服务不可用。" } };
    return { settings, ping: result.data };
  } catch (_) {
    return { error: { ok: false, code: "offline", error: "无法连接 Obsidian。请打开 Obsidian 并启用 Paper Library 浏览器扩展服务。" } };
  }
}

async function importCurrentPaper(info, includePdf, tabId) {
  const bridge = await requireBridge();
  if (bridge.error) return bridge.error;
  const metadata = metadataFrom(info);
  if (!includePdf) {
    const result = await postJson(bridge.settings, "/api/import", { metadata });
    return normalizeServerResult(result.status, result.data);
  }

  let pdfUrl = String(info?.pdfUrl || (info?.isPdfPage ? info?.url : ""));
  if (!pdfUrl) pdfUrl = await discoverOpenAccessPdf(info).catch(() => "");
  pdfUrl = normalizePublisherPdfUrl(pdfUrl, info);
  if (!pdfUrl) {
    return {
      ok: false,
      code: "no-pdf",
      error: "没有发现可下载的 PDF。若这是订阅论文，请先登录网站并打开“PDF / Full text”页面后再次导入。"
    };
  }

  const fileName = safeFileName(info, pdfUrl);
  let sawLoginPage = false;
  const pageDownload = await fetchPdfFromPage(tabId, pdfUrl);
  if (pageDownload?.kind === "pdf") {
    const result = await postPdf(bridge.settings, metadata, fileName, pageDownload.buffer);
    return normalizeServerResult(result.status, result.data);
  }
  sawLoginPage ||= pageDownload?.kind === "needs-login";

  const workerDownload = await fetchPdfFromWorker(pdfUrl);
  if (workerDownload.kind === "pdf") {
    const result = await postPdf(bridge.settings, metadata, fileName, workerDownload.buffer);
    return normalizeServerResult(result.status, result.data);
  }
  sawLoginPage ||= workerDownload.kind === "needs-login";

  if (isIeeePdfUrl(pdfUrl)) {
    const warmed = await warmPdfNavigation(pdfUrl);
    if (warmed) {
      const warmedDownload = await fetchPdfFromWorker(pdfUrl);
      if (warmedDownload.kind === "pdf") {
        const result = await postPdf(bridge.settings, metadata, fileName, warmedDownload.buffer);
        return normalizeServerResult(result.status, result.data);
      }
      sawLoginPage ||= warmedDownload.kind === "needs-login";
    }
  }

  // A navigation-grade download is required by some publisher endpoints that
  // reject fetch/XHR even when the user is authenticated.
  const browserDownload = await downloadPdfAsBrowserNavigation(pdfUrl);
  if (browserDownload.kind === "file") {
    const result = await postJson(bridge.settings, "/api/import", {
      metadata,
      filePath: browserDownload.path,
      fileName: browserDownload.fileName,
      cleanup: true
    });
    const normalized = normalizeServerResult(result.status, result.data);
    if (normalized.ok) return normalized;
    sawLoginPage ||= normalized.code === "needs-login";
  }

  // A publisher may expose a PDF button that works only through its own page
  // JavaScript or a library-access extension. Prefer that publisher copy, but
  // if it remains blocked use the same paper's OA/arXiv PDF rather than telling
  // an already-authenticated user that they lack permission.
  const openAccessUrl = normalizePublisherPdfUrl(
    await discoverOpenAccessPdf(info).catch(() => ""),
    info
  );
  if (openAccessUrl && openAccessUrl !== pdfUrl) {
    const openAccessDownload = await fetchPdfFromWorker(openAccessUrl);
    if (openAccessDownload.kind === "pdf") {
      const oaFileName = safeFileName(info, openAccessUrl);
      const result = await postPdf(bridge.settings, metadata, oaFileName, openAccessDownload.buffer);
      return normalizeServerResult(result.status, result.data);
    }
  }

  // Obsidian gets one final chance for genuinely public URLs. It intentionally
  // has no browser cookies, so an HTML response becomes a login prompt.
  const fallback = await postJson(bridge.settings, "/api/import", { metadata, pdfUrl, fileName });
  const normalizedFallback = normalizeServerResult(fallback.status, fallback.data);
  if (normalizedFallback.ok) return normalizedFallback;
  if (sawLoginPage || normalizedFallback.code === "needs-login") {
    return {
      ok: false,
      code: "needs-login",
      error: "该网站需要订阅或机构权限。请先在当前浏览器登录自己的账号，再打开论文 PDF 页面并重试。"
    };
  }
  return { ok: false, code: "no-pdf", error: normalizedFallback.error || "PDF 下载失败，可仅导入文献信息。" };
}

async function lookupCurrentPaper(info) {
  const bridge = await requireBridge();
  if (bridge.error) return bridge.error;
  const result = await postJson(bridge.settings, "/api/lookup", { metadata: metadataFrom(info) });
  if (result.status === 404) {
    return { ok: false, code: "upgrade-plugin", error: "请重新加载 Obsidian 中的 Paper Library 插件" };
  }
  if (result.status === 401) {
    return { ok: false, code: "bad-token", error: "Token 无效，请重新连接 Obsidian" };
  }
  return result.data?.ok
    ? { ok: true, found: Boolean(result.data.found), paper: result.data.paper || null }
    : { ok: false, code: "server", error: result.data?.error || "本地论文查询失败" };
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type === "paperlib:ping") {
    requireBridge().then((bridge) => respond(bridge.error || {
      ok: true,
      papers: bridge.ping?.papers
    })).catch((error) => respond({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === "paperlib:import") {
    importCurrentPaper(message.info || {}, message.includePdf !== false, message.tabId)
      .then(respond)
      .catch((error) => respond({ ok: false, code: "error", error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === "paperlib:lookup") {
    lookupCurrentPaper(message.info || {})
      .then(respond)
      .catch((error) => respond({ ok: false, code: "error", error: String(error?.message || error) }));
    return true;
  }
  return false;
});
