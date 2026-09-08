// Paper Library Web Importer — popup controller

"use strict";

const ui = {
  paperCard: document.getElementById("paper-card"),
  emptyCard: document.getElementById("empty-card"),
  title: document.getElementById("paper-title"),
  authors: document.getElementById("paper-authors"),
  meta: document.getElementById("paper-meta"),
  access: document.getElementById("access-state"),
  libraryBadge: document.getElementById("library-badge"),
  lookupSkeleton: document.getElementById("lookup-skeleton"),
  libraryCard: document.getElementById("library-card"),
  localVenue: document.getElementById("local-venue"),
  localRanks: document.getElementById("local-ranks"),
  citations: document.getElementById("metric-citations"),
  references: document.getElementById("metric-references"),
  metricYear: document.getElementById("metric-year"),
  metricType: document.getElementById("metric-type"),
  localStars: document.getElementById("local-stars"),
  localLabels: document.getElementById("local-labels"),
  metricsSource: document.getElementById("metrics-source"),
  status: document.getElementById("status"),
  importActions: document.getElementById("import-actions"),
  importPdf: document.getElementById("import-pdf-btn"),
  metadata: document.getElementById("metadata-btn"),
  settingsToggle: document.getElementById("settings-toggle"),
  settingsPanel: document.getElementById("settings-panel"),
  token: document.getElementById("token-input"),
  port: document.getElementById("port-input"),
  save: document.getElementById("save-config-btn"),
  test: document.getElementById("test-btn"),
  connection: document.getElementById("conn-state")
};

let currentPaper = null;
let currentTabId = null;
let currentLibraryPaper = null;

function pdfLike(value) {
  const url = String(value || "");
  return /\.pdf(?:$|[?#])/i.test(url)
    || /\/pdf(?:\/|$)/i.test(url)
    || /\/doi\/(?:e?pdf)\//i.test(url)
    || /\/content\/pdf\//i.test(url)
    || /\/stamp(?:PDF)?\/.*\.jsp/i.test(url)
    || /pdfft/i.test(url)
    || /arxiv\.org\/pdf\//i.test(url);
}

function cleanViewerTitle(value) {
  const title = String(value || "").replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
  return /^(?:pdf|full[ -]?text pdf|download pdf|chrome pdf viewer)$/i.test(title) ? "" : title;
}

async function activeTab() {
  return (await chrome.tabs.query({ active: true, currentWindow: true }))[0] || null;
}

function fallbackFromTab(tab) {
  const url = String(tab?.url || "");
  const isPdfPage = pdfLike(url) || /pdf/i.test(String(tab?.title || ""));
  const arxiv = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i)?.[1] || "";
  let site = "";
  try { site = new URL(url).hostname; } catch (_) { /* non-web tab */ }
  return {
    url,
    title: cleanViewerTitle(tab?.title),
    authors: [], year: 0, venue: "", abstract: "", doi: "", arxiv,
    pdfUrl: isPdfPage ? url : (arxiv ? `https://arxiv.org/pdf/${arxiv}` : ""),
    isPdfPage,
    site
  };
}

async function detect(tab) {
  if (!tab?.id) return fallbackFromTab(tab);
  try {
    const detected = await chrome.tabs.sendMessage(tab.id, { type: "paperlib:detect" });
    if (detected && typeof detected === "object") {
      if (!detected.pdfUrl && pdfLike(tab.url)) {
        detected.pdfUrl = tab.url;
        detected.isPdfPage = true;
      }
      if (!detected.title) detected.title = cleanViewerTitle(tab.title);
      return detected;
    }
  } catch (_) {
    // Browser PDF viewers and restricted pages do not accept content scripts.
  }
  return fallbackFromTab(tab);
}

function recognized(paper) {
  return Boolean(paper && (paper.title || paper.doi || paper.arxiv || paper.pdfUrl || paper.isPdfPage));
}

function addChip(text) {
  if (!text) return;
  const chip = document.createElement("span");
  chip.textContent = text;
  ui.meta.appendChild(chip);
}

function render(paper) {
  const available = recognized(paper);
  ui.paperCard.classList.toggle("hidden", !available);
  ui.emptyCard.classList.toggle("hidden", available);
  ui.importPdf.disabled = !available;
  ui.metadata.disabled = !available || (!paper?.title && !paper?.doi && !paper?.arxiv);
  if (!available) return;

  ui.title.textContent = paper.title || (paper.isPdfPage ? "当前 PDF" : "未识别标题");
  ui.authors.textContent = Array.isArray(paper.authors) && paper.authors.length
    ? `${paper.authors.slice(0, 5).join(", ")}${paper.authors.length > 5 ? " 等" : ""}`
    : "";
  ui.meta.replaceChildren();
  addChip(paper.venue);
  addChip(paper.year ? String(paper.year) : "");
  addChip(paper.doi ? `DOI ${paper.doi}` : "");
  addChip(paper.arxiv ? `arXiv ${paper.arxiv}` : "");

  if (paper.isPdfPage) {
    ui.access.className = "access-state ready";
    ui.access.textContent = "当前页面是 PDF，可以直接导入";
  } else if (paper.pdfUrl) {
    ui.access.className = "access-state ready";
    ui.access.textContent = "已发现 PDF；订阅网站将使用当前登录状态下载";
  } else {
    ui.access.className = "access-state pending";
    ui.access.textContent = "将先查找 Open Access PDF；订阅网站请先登录并打开全文页";
  }
}

function rankTone(system, rank) {
  if (/^IF(?:\s|$)/i.test(system)) return "metric";
  if (/录用率|acceptance rate/i.test(system)) return "rate";
  const value = String(rank || "").toLocaleUpperCase().replace(/\s+/g, "");
  if (/^(?:A\*?|Q1|1区)$/.test(value)) return "top";
  if (/^(?:B|Q2|2区)$/.test(value)) return "high";
  if (/^(?:C|Q3|3区)$/.test(value)) return "mid";
  return "base";
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date)
    : "";
}

function renderLibraryPaper(paper) {
  currentLibraryPaper = paper || null;
  const found = Boolean(paper);
  ui.libraryBadge.classList.toggle("hidden", !found);
  ui.libraryCard.classList.toggle("hidden", !found);
  ui.importActions.classList.toggle("hidden", found);
  if (!found) return;

  ui.localVenue.textContent = paper.venue || "未记录期刊或会议";
  ui.localRanks.replaceChildren();
  (paper.venueRanks || []).forEach(({ system, rank }) => {
    const pill = document.createElement("span");
    pill.className = `rank-pill ${rankTone(system, rank)}`;
    pill.textContent = `${system} · ${rank}`;
    ui.localRanks.appendChild(pill);
  });
  if (!ui.localRanks.childElementCount) {
    const empty = document.createElement("span");
    empty.className = "rank-empty";
    empty.textContent = "暂无分区或会议等级";
    ui.localRanks.appendChild(empty);
  }

  const metric = (value) => Number.isFinite(Number(value)) && value !== null ? Number(value).toLocaleString() : "—";
  ui.citations.textContent = metric(paper.citations);
  ui.references.textContent = metric(paper.references);
  ui.metricYear.textContent = paper.year ? String(paper.year) : "—";
  ui.metricType.textContent = paper.type || "—";
  ui.metricType.title = paper.type || "";

  ui.localStars.classList.toggle("hidden", !(paper.rating > 0));
  ui.localStars.textContent = paper.rating > 0 ? `${"★".repeat(paper.rating)}${"☆".repeat(5 - paper.rating)}` : "";
  ui.localLabels.replaceChildren();
  [...(paper.collections || []).map((value) => `⌁ ${value}`), ...(paper.tags || []).map((value) => `#${value}`)]
    .slice(0, 8)
    .forEach((value) => {
      const label = document.createElement("span");
      label.textContent = value;
      ui.localLabels.appendChild(label);
    });
  const updated = formatDate(paper.metricsUpdatedAt);
  ui.metricsSource.textContent = `${paper.hasPdf ? "PDF 已保存" : "仅文献信息"} · ${paper.metricsSource || "本地论文库"}${updated ? ` · ${updated} 更新` : ""}`;
  ui.access.className = "access-state ready in-library";
  ui.access.textContent = "已存在于 Paper Library，不会重复导入";
}

async function refreshLibraryStatus() {
  if (!recognized(currentPaper)) return;
  ui.lookupSkeleton.classList.remove("hidden");
  ui.importActions.classList.add("hidden");
  try {
    const reply = await chrome.runtime.sendMessage({ type: "paperlib:lookup", info: currentPaper });
    if (reply?.ok) {
      renderLibraryPaper(reply.found ? reply.paper : null);
      if (!reply.found) ui.importActions.classList.remove("hidden");
      return;
    }
    renderLibraryPaper(null);
    ui.importActions.classList.remove("hidden");
    if (reply?.code === "upgrade-plugin") status("working", reply.error);
  } catch (_) {
    renderLibraryPaper(null);
    ui.importActions.classList.remove("hidden");
  } finally {
    ui.lookupSkeleton.classList.add("hidden");
  }
}

function status(kind, message) {
  ui.status.className = `status ${kind}`;
  ui.status.textContent = message;
}

function clearStatus() {
  ui.status.className = "status hidden";
  ui.status.textContent = "";
}

function setBusy(busy) {
  ui.importPdf.disabled = busy || !recognized(currentPaper);
  ui.metadata.disabled = busy || !recognized(currentPaper);
}

async function refreshConnection() {
  ui.connection.className = "conn-state";
  ui.connection.textContent = "正在检测…";
  try {
    const reply = await chrome.runtime.sendMessage({ type: "paperlib:ping" });
    if (reply?.ok) {
      ui.connection.classList.add("ok");
      ui.connection.textContent = `已连接 · ${reply.papers ?? "—"} 篇`;
    } else {
      ui.connection.classList.add("error");
      ui.connection.textContent = reply?.code === "bad-token" ? "Token 无效" : "未连接 Obsidian";
    }
  } catch (_) {
    ui.connection.classList.add("error");
    ui.connection.textContent = "未连接 Obsidian";
  }
}

async function importPaper(includePdf) {
  if (!currentPaper) return;
  setBusy(true);
  status("working", includePdf ? "正在获取 PDF，并交给 Obsidian 导入…" : "正在导入文献信息…");
  try {
    const reply = await chrome.runtime.sendMessage({
      type: "paperlib:import",
      info: currentPaper,
      includePdf,
      tabId: currentTabId
    });
    if (reply?.ok) {
      status(reply.duplicate && !reply.attachedPdf ? "working" : "success", reply.attachedPdf
        ? `已为现有条目补充 PDF：${reply.title || currentPaper.title}`
        : reply.duplicate
          ? `库中已有：${reply.title || currentPaper.title}`
        : reply.metadataOnly
          ? `文献信息已导入：${reply.title || currentPaper.title}`
          : `PDF 已导入：${reply.title || currentPaper.title || "当前论文"}`);
      await refreshConnection();
      await refreshLibraryStatus();
      return;
    }
    status(reply?.code === "needs-login" ? "login" : "error", reply?.error || "导入失败");
    if (reply?.code === "needs-login" || reply?.code === "no-pdf") ui.metadata.classList.add("emphasize");
  } catch (error) {
    status("error", String(error?.message || error || "导入失败"));
  } finally {
    setBusy(false);
  }
}

async function initialize() {
  const stored = await chrome.storage.local.get(["paperlibToken", "paperlibPort"]);
  ui.token.value = stored.paperlibToken || "";
  ui.port.value = stored.paperlibPort || 23987;

  ui.settingsToggle.addEventListener("click", () => {
    const hidden = ui.settingsPanel.classList.toggle("hidden");
    ui.settingsToggle.setAttribute("aria-expanded", String(!hidden));
  });
  ui.save.addEventListener("click", async () => {
    await chrome.storage.local.set({
      paperlibToken: ui.token.value.trim(),
      paperlibPort: Math.min(65535, Math.max(1024, Number(ui.port.value) || 23987))
    });
    status("success", "连接设置已保存");
    await refreshConnection();
  });
  ui.test.addEventListener("click", refreshConnection);
  ui.importPdf.addEventListener("click", () => { clearStatus(); void importPaper(true); });
  ui.metadata.addEventListener("click", () => { clearStatus(); void importPaper(false); });

  const tab = await activeTab();
  currentTabId = tab?.id ?? null;
  currentPaper = await detect(tab);
  render(currentPaper);
  await refreshConnection();
  await refreshLibraryStatus();
}

void initialize();
