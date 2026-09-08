const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const obsidianMock = {
  ItemView: class {},
  Menu: class {},
  Modal: class {},
  Notice: class {},
  Platform: { isMobile: true, isMobileApp: true },
  Plugin: class {},
  PluginSettingTab: class {},
  Setting: class {},
  loadPdfJs: async () => null,
  normalizePath: (value) => value,
  requestUrl: async () => ({ json: {} }),
  setIcon: () => {}
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "obsidian") return obsidianMock;
  return originalLoad.call(this, request, parent, isMain);
};
const PaperLibraryPlugin = require("../main.js");
Module._load = originalLoad;

async function run() {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
  assert.equal(manifest.isDesktopOnly, false);

  const plugin = Object.create(PaperLibraryPlugin.prototype);
  plugin.mobile = true;
  const syncPlugin = Object.create(PaperLibraryPlugin.prototype);
  const baselineSettings = {
    papers: [{ id: "paper-a", title: "Old title", starred: false, tags: [], collections: [] }],
    tags: [], collections: []
  };
  const localSettings = {
    papers: [{ id: "paper-a", title: "Old title", starred: true, tags: [], collections: [] }],
    tags: ["local"], collections: []
  };
  const diskSettings = {
    papers: [
      { id: "paper-a", title: "Synced title", starred: false, tags: [], collections: [] },
      { id: "paper-b", title: "New desktop paper", starred: false, tags: [], collections: [] }
    ],
    tags: ["remote"], collections: []
  };
  const mergedSettings = syncPlugin.mergeSyncedSettings(localSettings, diskSettings, baselineSettings);
  assert.equal(mergedSettings.papers.length, 2);
  assert.equal(mergedSettings.papers.find((paper) => paper.id === "paper-a").title, "Synced title");
  assert.equal(mergedSettings.papers.find((paper) => paper.id === "paper-a").starred, true);
  assert.equal(mergedSettings.papers.find((paper) => paper.id === "paper-b").title, "New desktop paper");
  assert.deepEqual(mergedSettings.tags.sort(), ["local", "remote"]);
  const staleMissingCopy = syncPlugin.mergeSyncedSettings(
    { papers: [{ id: "paper-new", title: "New import" }], paperDeletionTombstones: {} },
    { papers: [], paperDeletionTombstones: {} },
    { papers: [{ id: "paper-new", title: "New import" }], paperDeletionTombstones: {} }
  );
  assert.equal(staleMissingCopy.papers.length, 1, "旧设备缺少记录时不应把新导入论文当作删除");
  const explicitDeletion = syncPlugin.mergeSyncedSettings(
    { papers: [{ id: "paper-new", title: "New import" }], paperDeletionTombstones: {} },
    { papers: [], paperDeletionTombstones: { "paper-new": "2026-08-26T10:00:00.000Z" } },
    { papers: [{ id: "paper-new", title: "New import" }], paperDeletionTombstones: {} }
  );
  assert.equal(explicitDeletion.papers.length, 0, "带墓碑的显式删除应同步到其他设备");
  const persistedImport = syncPlugin.settingsForPersistence({
    papers: [{ id: "busy", importStatus: "organizing" }, { id: "failed", importStatus: "error", importError: "bad" }]
  });
  assert.equal(persistedImport.papers[0].importStatus, undefined, "运行中的导入状态不应写入 data.json");
  assert.equal(persistedImport.papers[1].importStatus, "error", "失败状态应保留用于诊断");
  const activeReferencePlugin = Object.create(PaperLibraryPlugin.prototype);
  const activePaper = { id: "active-import", title: "Local title", importStatus: "online", tags: [], collections: [] };
  activeReferencePlugin.mobile = true;
  activeReferencePlugin.activePaperImportIds = new Set([activePaper.id]);
  activeReferencePlugin.settings = { papers: [activePaper], tags: [], collections: [] };
  activeReferencePlugin.refreshViews = () => {};
  activeReferencePlugin.restorePaperRelationCache = () => {};
  activeReferencePlugin.applyReloadedSettings({
    papers: [{ id: activePaper.id, title: "Synced title", importStatus: "online", tags: [], collections: [] }],
    tags: [], collections: []
  });
  assert.equal(activeReferencePlugin.settings.papers[0], activePaper, "同步合并不得替换活动导入对象引用");
  assert.equal(activePaper.title, "Synced title");
  const reloadPlugin = Object.create(PaperLibraryPlugin.prototype);
  reloadPlugin.mobile = true;
  reloadPlugin.settings = syncPlugin.cloneSettingsValue(baselineSettings);
  reloadPlugin.settingsPersistenceBaseline = syncPlugin.cloneSettingsValue(baselineSettings);
  reloadPlugin.settingsPersistenceFingerprint = syncPlugin.settingsFingerprint(baselineSettings);
  reloadPlugin.settingsSaveQueue = Promise.resolve();
  reloadPlugin.settingsSyncPollActive = false;
  reloadPlugin.loadData = async () => diskSettings;
  reloadPlugin.refreshViews = () => {};
  reloadPlugin.restorePaperRelationCache = () => {};
  assert.equal(await reloadPlugin.reloadSyncedSettingsIfChanged(), true);
  assert.equal(reloadPlugin.settings.papers.some((paper) => paper.id === "paper-b"), true);
  assert.equal(plugin.isMobileApp(), true);
  assert.equal(plugin.isDocLayoutRuntimeInstalled(), false);
  assert.equal(plugin.hasDocLayoutRuntimeArtifacts(), false);
  assert.throws(() => plugin.getDesktopPluginPath("models/model.onnx"), /仅支持桌面端/);
  await assert.rejects(plugin.runDesktopProcess("python", []), /仅支持桌面端/);

  assert.equal(
    plugin.selectReliablePdfTitle({
      embeddedTitle: "",
      guessedTitle: "This paper is included in the Proceedings of the",
      fallbackTitle: "CLONE Customizing LLMs for Efficient Latency-Aware Inference at the Edge",
      fileName: "CLONE Customizing LLMs for Efficient Latency-Aware Inference at the Edge.pdf"
    }),
    "CLONE Customizing LLMs for Efficient Latency-Aware Inference at the Edge"
  );
  assert.equal(
    plugin.selectReliablePdfTitle({
      embeddedTitle: "",
      guessedTitle: "yond simple chatbots into dynamic, general-purpose agentic",
      fallbackTitle: "Agentix An Efficient Serving Engine for LLM Agents as General Programs",
      fileName: "Agentix An Efficient Serving Engine for LLM Agents as General Programs.pdf"
    }),
    "Agentix An Efficient Serving Engine for LLM Agents as General Programs"
  );
  const cloneLines = plugin.pdfTextLines([
    { str: "USENIX", transform: [40, 0, 0, 40, 310, 760], width: 160, height: 40 },
    { str: "CLONE: Customizing LLMs for Efficient", transform: [24, 0, 0, 24, 110, 680], width: 430, height: 24 },
    { str: "Latency-Aware Inference at the Edge", transform: [24, 0, 0, 24, 150, 650], width: 390, height: 24 },
    { str: "This paper is included in the Proceedings of the", transform: [18, 0, 0, 18, 120, 180], width: 440, height: 18 },
    { str: "Body text for the paper begins here and continues normally.", transform: [10, 0, 0, 10, 90, 500], width: 420, height: 10 }
  ]);
  assert.equal(
    plugin.guessTitleFromPdfLayout([cloneLines]),
    "CLONE: Customizing LLMs for Efficient Latency-Aware Inference at the Edge"
  );
  const docLayoutPlugin = Object.create(PaperLibraryPlugin.prototype);
  docLayoutPlugin.isMobileApp = () => false;
  docLayoutPlugin.isDocLayoutRuntimeInstalled = () => true;
  docLayoutPlugin.runDocLayoutTitleExtraction = async () => ({ titleCandidates: [
    {
      text: "CLONE: Customizing LLMs for Efficient Latency-Aware Inference at the Edge Chunlin Tian Xinpeng Qin Kahou Tam",
      confidence: 0.9378, pageNumber: 1
    },
    {
      text: "CLONE: Customizing LLMs for Efficient Latency-Aware Inference at the Edge",
      confidence: 0.8621, pageNumber: 1
    },
    { text: "This paper is included in the Proceedings of the", confidence: 0.72, pageNumber: 1 }
  ] });
  const docLayoutConfirmation = await docLayoutPlugin.confirmPaperTitleWithDocLayout(
    { pdfPath: "Papers/clone.pdf", title: "This paper is included in the Proceedings of the" },
    { title: "This paper is included in the Proceedings of the" }
  );
  assert.equal(
    docLayoutConfirmation.title,
    "CLONE: Customizing LLMs for Efficient Latency-Aware Inference at the Edge"
  );
  docLayoutPlugin.runDocLayoutTitleExtraction = async () => ({ titleCandidates: [
    { text: "p y , 1 Introduction L l d l (LLM ) t", confidence: 0.8906, pageNumber: 1 },
    { text: "Abstract L l d l (LLM) li i l i b", confidence: 0.8842, pageNumber: 1 },
    {
      text: "Agentix: An Efficient Serving Engine for LLM Agents as General Programs",
      confidence: 0.6371, pageNumber: 1
    }
  ] });
  const agentixConfirmation = await docLayoutPlugin.confirmPaperTitleWithDocLayout(
    { pdfPath: "Papers/agentix.pdf", title: "yond simple chatbots into dynamic, general-purpose agentic" },
    { title: "yond simple chatbots into dynamic, general-purpose agentic" }
  );
  assert.equal(
    agentixConfirmation.title,
    "Agentix: An Efficient Serving Engine for LLM Agents as General Programs"
  );

  let openedFile = null;
  let openedWorkspace = false;
  const pdfFile = { path: "Papers/TENET-v2.pdf", extension: "pdf" };
  plugin.app = {
    vault: { getAbstractFileByPath: () => pdfFile },
    workspace: { getLeaf: () => ({ openFile: async (file) => { openedFile = file; } }) }
  };
  plugin.uiState = {};
  plugin.settings = { pdfAnnotationHintShown: true };
  plugin.ensurePaperNote = async () => {};
  plugin.openResearchWorkspace = async () => { openedWorkspace = true; };
  await plugin.openPaperPdf({ id: "tenet", pdfPath: pdfFile.path }, { native: true });
  assert.equal(openedFile, pdfFile);
  assert.equal(openedWorkspace, false);

  const batchPlugin = Object.create(PaperLibraryPlugin.prototype);
  batchPlugin.settings = {
    papers: [], tags: [], collections: [], onlineMetadataLookup: true,
    libraryFolder: "Papers", notesFolder: "Papers", pdfsFolder: "Papers/PDFs"
  };
  batchPlugin.app = { vault: {
    getAbstractFileByPath: (filePath) => ({ path: filePath, name: filePath.split("/").pop(), extension: "pdf" }),
    readBinary: async () => new TextEncoder().encode("%PDF-local").buffer
  } };
  batchPlugin.saveSettings = async () => {};
  batchPlugin.refreshViews = () => {};
  batchPlugin.getAvailableOrganizedPaperPaths = (paper) => ({
    pdfPath: `Papers/Uncategorized/Unknown year/${paper.title}.pdf`,
    notePath: `Papers/Uncategorized/Unknown year/${paper.title}.md`
  });
  batchPlugin.saveDroppedPdf = async (_pending, desiredPath) => desiredPath;
  let localStartedAfterEveryPdfWasVisible = true;
  batchPlugin.extractLocalPdfMetadata = async (_buffer, fileName) => {
    localStartedAfterEveryPdfWasVisible &&= batchPlugin.settings.papers.every((paper) => Boolean(paper.pdfPath));
    return {
      title: `Local ${fileName.replace(/\.pdf$/i, "")}`, authors: ["Local Author"],
      year: 2026, venue: "HPCA", abstract: "", tags: [], doi: "", arxiv: ""
    };
  };
  batchPlugin.lookupPaperMetadata = async (local) => ({
    ...local, source: "Crossref", title: `Final ${local.title}`, abstract: `Abstract for ${local.title}`
  });
  batchPlugin.enrichPaperVenueRanks = async (paper) => { paper.venueRanks = [{ system: "CCF", rank: "A" }]; };
  batchPlugin.organizePaperFiles = async () => {};
  batchPlugin.ensurePaperNote = async () => {};
  const pdfBytes = new TextEncoder().encode("%PDF-test").buffer;
  const batchResult = await batchPlugin.importPdfBatch([
    { name: "Alpha.pdf", type: "application/pdf", arrayBuffer: async () => pdfBytes.slice(0) },
    { name: "Beta.pdf", type: "application/pdf", arrayBuffer: async () => pdfBytes.slice(0) }
  ]);
  assert.deepEqual(batchResult, { imported: 2, failed: 0 });
  assert.equal(localStartedAfterEveryPdfWasVisible, true);
  assert.equal(batchPlugin.settings.papers.length, 2);
  assert.ok(batchPlugin.settings.papers.every((paper) => paper.pdfPath && !paper.importStatus));
  assert.deepEqual(batchPlugin.settings.papers.map((paper) => paper.originalPdfName), ["Alpha.pdf", "Beta.pdf"]);
  assert.ok(batchPlugin.settings.papers.every((paper) => paper.title.startsWith("Final Local ")));
  assert.ok(batchPlugin.settings.papers.every((paper) => paper.abstract.startsWith("Abstract for Local ")));

  const tabletPlugin = Object.create(PaperLibraryPlugin.prototype);
  tabletPlugin.mobile = true;
  const hiddenSidebarLeaf = { view: { getViewType: () => "paper-library-view" } };
  const tabletLeaf = {
    state: null,
    setViewState: async (state) => { tabletLeaf.state = state; },
    view: { getViewType: () => "empty" }
  };
  let revealedTabletLeaf = null;
  tabletPlugin.app = { workspace: {
    activeLeaf: { view: { getViewType: () => "markdown" } },
    getLeavesOfType: () => [hiddenSidebarLeaf],
    getLeaf: () => tabletLeaf,
    revealLeaf: (leaf) => { revealedTabletLeaf = leaf; }
  } };
  await tabletPlugin.activateMainView(true);
  assert.equal(tabletLeaf.state.type, "paper-library-view");
  assert.equal(revealedTabletLeaf, tabletLeaf);

  const mainSource = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  const stylesSource = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  assert.match(mainSource, /function itemViewContentRoot/);
  assert.doesNotMatch(mainSource, /this\.containerEl\.children\[1\]/);
  assert.match(stylesSource, /\(any-pointer: coarse\)/);
  assert.match(mainSource, /addRibbonIcon\("library", "Open Paper Library"/);
  assert.doesNotMatch(mainSource, /addRibbonIcon\("library-big"/);
  assert.match(mainSource, /iconButton\(tabs, "edit-3", "编辑论文信息"/);
  assert.match(mainSource, /iconButton\(tabs, "bar-chart-2", "论文数据"/);
  assert.match(mainSource, /paperlib-icon-fallback/);
  assert.match(mainSource, /const PAPERLIB_ICON_ALIASES =/);
  assert.match(mainSource, /"panel-left-open": \["panel-left", "sidebar", "menu"\]/);
  assert.match(mainSource, /"file-plus-2": \["file-plus", "plus-square", "plus"\]/);
  assert.match(mainSource, /if \(!isExpanded && !this\.plugin\.isMobileApp\(\)\)/);
  assert.match(mainSource, /async importPdfBatch\(files, hints = \[\]\)/);
  assert.match(mainSource, /await this\.runBatchImportWorkers\(entries, 4/);
  assert.match(mainSource, /await this\.runBatchImportWorkers\(savedEntries, 3/);
  assert.match(mainSource, /await this\.runBatchImportWorkers\(savedEntries, 2/);
  assert.match(stylesSource, /\.paperlib-mobile-toolbar-actions \.paperlib-icon-button > \.paperlib-icon-fallback/);
  assert.match(stylesSource, /\.paperlib-abstract-toggle\.is-hidden[\s\S]*?visibility: visible;/);
  assert.match(stylesSource, /workspace-tab-header\[data-type="paper-library-navigation-view"\]/);
  assert.match(stylesSource, /\.paperlib-sidebar[\s\S]*?background: transparent;/);

  const mobileEntryPlugin = Object.create(PaperLibraryPlugin.prototype);
  mobileEntryPlugin.mobile = true;
  const entryCalls = [];
  mobileEntryPlugin.ensureNavigationView = async (reveal) => { entryCalls.push(["navigation", reveal]); };
  mobileEntryPlugin.activateMainView = async (reveal) => { entryCalls.push(["main", reveal]); };
  await mobileEntryPlugin.activateView();
  assert.deepEqual(entryCalls, [["navigation", false], ["main", true]]);

  const recognizedFigure = {
    figureKey: "doclayout:2:1", pageNumber: 2,
    pageWidth: 1224, pageHeight: 1584,
    x: 93, y: 91, width: 510, height: 362,
    label: "Figure 1", caption: "Portable figure"
  };
  plugin.settings.papers = [{
    id: "tenet", pdfPath: pdfFile.path, attachments: [],
    figureCatalogs: {
      [pdfFile.path]: { engine: "doclayout-yolo-onnx", totalPages: 10, figures: [recognizedFigure] }
    }
  }];
  plugin.pdfFigureCatalogCache = new Map();
  plugin.pdfFigureProgressListeners = new Map();
  const fakeDocument = { getPage: async () => ({}) };
  plugin.loadPdfFigureDocument = async () => fakeDocument;
  const mobileCatalog = await plugin.getPdfFigureCatalog(pdfFile.path);
  assert.equal(mobileCatalog.document, fakeDocument);
  assert.equal(mobileCatalog.figures[0].caption, "Portable figure");
  assert.deepEqual(mobileCatalog.pageSizes.get(2), { width: 1224, height: 1584 });
  plugin.manifest = { dir: "/private/vault/.obsidian/plugins/obsidian-paper-library" };
  plugin.app.vault.configDir = ".obsidian";
  assert.equal(
    plugin.getPluginVaultPath("figure-cache/example/figures.json"),
    ".obsidian/plugins/obsidian-paper-library/figure-cache/example/figures.json"
  );

  const rankPlugin = Object.create(PaperLibraryPlugin.prototype);
  const completeRankingSample = rankPlugin.parseConferenceRankingDatabase(`
- title: SIGOPS ATC
  description: ACM SIGOPS Annual Technical Conference
  sub: DS
  rank:
    ccf: A
    core: A
    thcpl: A
  dblp: usenix
  confs:
  - year: 2025
    id: atc2025
- title: NSDI
  description: USENIX Symposium on Networked Systems Design and Implementation
  sub: NW
  rank:
    ccf: A
    core: N
    thcpl: A
  dblp: nsdi
  confs:
  - year: 2026
    id: nsdi26
- title: MobiSys
  description: ACM International Conference on Mobile Systems, Applications, and Services
  sub: NW
  rank:
    ccf: B
    core: A
    thcpl: A
  dblp: mobisys
  confs:
  - year: 2026
    id: mobisys26
`);
  rankPlugin.settings = {
    onlineMetadataLookup: true,
    conferenceRankingDatabase: {
      updatedAt: new Date().toISOString(), source: "CCFDDL", conferences: completeRankingSample
    }
  };
  rankPlugin.syncConferenceRankingDatabase = async () => rankPlugin.settings.conferenceRankingDatabase;
  rankPlugin.lookupConferenceAcceptanceRate = async () => null;
  const hpcaPaper = { venue: "HPCA", year: 2026, venueRanks: [] };
  assert.equal(await rankPlugin.enrichPaperVenueRanks(hpcaPaper, { force: true }), true);
  assert.deepEqual(
    hpcaPaper.venueRanks.map(({ system, rank }) => `${system}:${rank}`),
    ["CCF:A", "CORE:A*", "TH-CPL:A"]
  );

  const orangePaper = {
    venue: "International Symposium on High-Performance Computer Architecture",
    year: 2026,
    venueRanks: []
  };
  assert.equal(await rankPlugin.enrichPaperVenueRanks(orangePaper, { force: true }), true);
  assert.deepEqual(
    orangePaper.venueRanks.map(({ system, rank }) => `${system}:${rank}`),
    ["CCF:A", "CORE:A*", "TH-CPL:A"]
  );
  assert.equal(
    rankPlugin.formatVenueDisplay(orangePaper.venue),
    "HPCA · IEEE International Symposium on High Performance Computer Architecture"
  );
  assert.deepEqual(
    rankPlugin.getAutomaticVenueRanks(orangePaper.venue).map(({ system, rank }) => `${system}:${rank}`),
    ["CCF:A", "CORE:A*", "TH-CPL:A"]
  );

  const tmacPaper = {
    venue: "Proceedings of the Twentieth European Conference on Computer Systems",
    year: 2025,
    venueRanks: []
  };
  assert.equal(await rankPlugin.enrichPaperVenueRanks(tmacPaper, { force: true }), true);
  assert.deepEqual(
    tmacPaper.venueRanks.map(({ system, rank }) => `${system}:${rank}`),
    ["CCF:A", "CORE:A", "TH-CPL:A"]
  );
  assert.equal(
    rankPlugin.formatVenueDisplay(tmacPaper.venue),
    "EuroSys · European Conference on Computer Systems"
  );
  const atcPaper = { venue: "USENIX ATC", year: 2025, venueRanks: [] };
  assert.equal(await rankPlugin.enrichPaperVenueRanks(atcPaper, { force: true }), true);
  assert.deepEqual(
    atcPaper.venueRanks.map(({ system, rank }) => `${system}:${rank}`),
    ["CCF:A", "CORE:A", "TH-CPL:A"]
  );
  const nsdiPaper = { venue: "NSDI", year: 2026, venueRanks: [] };
  assert.equal(await rankPlugin.enrichPaperVenueRanks(nsdiPaper, { force: true }), true);
  assert.deepEqual(
    nsdiPaper.venueRanks.map(({ system, rank }) => `${system}:${rank}`),
    ["CCF:A", "CORE:N", "TH-CPL:A"]
  );
  const fblayoutPaper = {
    venue: "Proceedings of the 24th Annual International Conference on Mobile Systems, Applications and Services",
    year: 2026,
    venueRanks: []
  };
  assert.equal(await rankPlugin.enrichPaperVenueRanks(fblayoutPaper, { force: true }), true);
  assert.deepEqual(
    fblayoutPaper.venueRanks.map(({ system, rank }) => `${system}:${rank}`),
    ["CCF:B", "CORE:A", "TH-CPL:A"]
  );

  delete rankPlugin.lookupConferenceAcceptanceRate;
  rankPlugin.settings.conferenceRateCache = {};
  rankPlugin.loadConferenceAcceptanceRates = async (rule) => {
    assert.equal(rule.shortName, "HPCA");
    return [{ year: 2026, rate: 0.214 }];
  };
  assert.deepEqual(
    await rankPlugin.lookupConferenceAcceptanceRate(orangePaper, true),
    { system: "录用率 2026", rank: "21.4%" }
  );

  const databasePlugin = Object.create(PaperLibraryPlugin.prototype);
  const parsedSeries = databasePlugin.parseConferenceRateDatabase({
    conferences: [{
      series: "DAC",
      yearly_data: [{ year: 2025, main_track: { num_acc: 420, num_sub: 1862 } }]
    }]
  });
  assert.equal(parsedSeries.DAC[0].year, 2025);
  assert.equal(parsedSeries.DAC[0].accepted, 420);
  assert.equal(parsedSeries.DAC[0].submitted, 1862);
  databasePlugin.settings = {
    onlineMetadataLookup: true,
    conferenceRateCache: {},
    conferenceRateDatabase: {
      updatedAt: new Date().toISOString(), source: "CS Conf Stats", series: parsedSeries
    },
    conferenceRankingDatabase: rankPlugin.settings.conferenceRankingDatabase
  };
  databasePlugin.syncConferenceRankingDatabase = async () => databasePlugin.settings.conferenceRankingDatabase;
  databasePlugin.conferenceRateLoading = new Map();
  databasePlugin.conferenceRateDatabaseLastAttemptAt = 0;
  const vedaPaper = {
    venue: "2025 62nd ACM/IEEE Design Automation Conference (DAC)",
    year: 2025,
    venueRanks: []
  };
  assert.equal(await databasePlugin.enrichPaperVenueRanks(vedaPaper), true);
  assert.deepEqual(
    vedaPaper.venueRanks.map(({ system, rank }) => `${system}:${rank}`),
    ["CCF:A", "CORE:A*", "TH-CPL:A", "录用率 2025:22.6%"]
  );
  console.log("Mobile compatibility tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
