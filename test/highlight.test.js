const assert = require("node:assert/strict");
const Module = require("node:module");

const notices = [];
let pdfJsMock = null;
let requestUrlMock = null;
const obsidianMock = {
  ItemView: class {},
  Menu: class {},
  Modal: class {},
  Notice: class { constructor(message) { notices.push(message); } },
  Plugin: class {},
  PluginSettingTab: class {},
  Setting: class {},
  loadPdfJs: async () => pdfJsMock,
  normalizePath: (path) => String(path).replace(/\\/g, "/").replace(/^\.\//, ""),
  requestUrl: async (options) => requestUrlMock(options),
  setIcon: () => {}
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "obsidian") return obsidianMock;
  return originalLoad.call(this, request, parent, isMain);
};
const PaperLibraryPlugin = require("../main.js");
Module._load = originalLoad;

function createPlugin() {
  const plugin = Object.create(PaperLibraryPlugin.prototype);
  plugin.settings = {
    papers: [{
      id: "paper-test",
      title: "Test paper",
      pdfPath: "Papers/test.pdf",
      annotations: []
    }],
    annotationHeading: "PDF Annotations",
    defaultHighlightColor: "Yellow"
  };
  plugin.lastAnnotationKey = "";
  plugin.app = {
    workspace: { getActiveFile: () => ({ path: "Papers/test.pdf", extension: "pdf" }) },
    vault: {
      read: async () => "# Test paper\n\n## PDF Annotations\n",
      modify: async (_file, content) => { plugin.modifiedContent = content; }
    }
  };
  plugin.ensurePaperNote = async () => ({ path: "Papers/Test paper.md" });
  plugin.saveSettings = async () => { plugin.didSaveSettings = true; };
  return plugin;
}

async function run() {
  const plugin = createPlugin();
  const selection = { toString: () => "selected text" };
  const pdfPlus = {
    settings: { colors: { Yellow: "#ffd000", Note: "#086ddd" } },
    lib: {
      copyLink: {
        getPageAndTextRangeFromSelection: (value) => {
          assert.equal(value, selection);
          return {
            page: 3,
            selection: { beginIndex: 12, beginOffset: 4, endIndex: 15, endOffset: 20 }
          };
        }
      }
    }
  };
  const menu = {
    plugin: pdfPlus,
    child: {
      file: { path: "Papers/test.pdf" },
      containerEl: { win: { getSelection: () => selection } }
    }
  };
  const context = plugin.getPdfPlusMenuContext(menu, { pageNumber: 3, selection: "selected text" });
  assert.equal(context.paper.id, "paper-test");
  assert.deepEqual(context.range, { beginIndex: 12, beginOffset: 4, endIndex: 15, endOffset: 20 });
  assert.deepEqual(plugin.getPdfPlusColors(pdfPlus), ["Yellow", "Note"]);

  const menuTitles = [];
  const colorTitles = [];
  const menuWithItems = {
    ...menu,
    addItem: (builder) => {
      const item = {
        setTitle(title) { menuTitles.push(title); return this; },
        setIcon() { return this; },
        setSection() { return this; },
        onClick(callback) { this.callback = callback; return this; },
        setSubmenu() {
          return {
            addItem(colorBuilder) {
              colorBuilder({
                setTitle(title) { colorTitles.push(title); return this; },
                setIcon() { return this; },
                onClick() { return this; }
              });
            }
          };
        }
      };
      builder(item);
      return menuWithItems;
    }
  };
  plugin.addPdfPlusMenuItems(menuWithItems, { pageNumber: 3, selection: "selected text" });
  assert.deepEqual(menuTitles, ["保存到论文笔记（Yellow）", "高亮并添加批注…", "选择其他高亮颜色"]);
  assert.deepEqual(colorTitles, ["Yellow", "Note"]);

  const saved = await plugin.savePdfHighlight(context, "Yellow", "my comment");
  assert.equal(saved, true);
  assert.match(plugin.modifiedContent, /#page=3&selection=12,4,15,20&color=yellow/);
  assert.match(plugin.modifiedContent, /> \[!pdf\|yellow\]\+ PDF 高亮 · p\. 3/);
  assert.match(plugin.modifiedContent, /\*\*批注：\*\* my comment/);
  assert.equal(plugin.settings.papers[0].annotations[0].selection.beginIndex, 12);
  assert.equal(plugin.settings.papers[0].annotations[0].color, "Yellow");
  assert.equal(plugin.didSaveSettings, true);
  assert.equal(notices.length, 1);

  const duplicate = await plugin.savePdfHighlight(context, "Yellow", "my comment");
  assert.equal(duplicate, false);

  let destroyed = false;
  pdfJsMock = {
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getMetadata: async () => ({
          info: {
            Title: "Accurate paper title from metadata",
            Author: "Ada Lovelace; Alan Turing",
            Keywords: "optics, imaging",
            CreationDate: "D:20240101000000"
          },
          metadata: { getAll: () => ({}) }
        }),
        getPage: async () => ({
          getTextContent: async () => ({
            items: [
              { str: "Accurate paper title from metadata", hasEOL: true },
              { str: "doi: 10.1234/example.5678", hasEOL: true },
              { str: "Abstract This is a sufficiently long abstract for testing automatic extraction from the PDF text layer. Introduction", hasEOL: true }
            ]
          })
        }),
        destroy: async () => { destroyed = true; }
      })
    })
  };
  const localMetadata = await plugin.extractLocalPdfMetadata(
    new TextEncoder().encode("%PDF-1.7 test").buffer,
    "unhelpful-file-name.pdf"
  );
  assert.equal(localMetadata.title, "Accurate paper title from metadata");
  assert.deepEqual(localMetadata.authors, ["Ada Lovelace", "Alan Turing"]);
  assert.equal(localMetadata.doi, "10.1234/example.5678");
  assert.equal(localMetadata.year, 2024);
  assert.equal(localMetadata.venue, "");
  assert.deepEqual(localMetadata.tags, ["optics", "imaging"]);
  assert.equal(destroyed, true);
  assert.equal(
    plugin.guessTitleFromPdfText(
      "All-optical image denoising using a diffractive visual processor\nAda Lovelace, Alan Turing\nAbstract\nThis is a much longer abstract sentence that must not be mistaken for the paper title during import.",
      "fallback"
    ),
    "All-optical image denoising using a diffractive visual processor"
  );
  assert.equal(
    plugin.guessVenueFromPdfText(
      "31st Conference on Neural Information Processing Systems (NIPS 2017), Long Beach, CA, USA"
    ),
    "NIPS"
  );

  requestUrlMock = async (options) => {
    assert.match(options.url, /api\.crossref\.org\/works\/10\.1234%2Fexample\.5678/);
    return {
      json: {
        message: {
          title: ["Accurate paper title from metadata"],
          author: [{ given: "Ada", family: "Lovelace" }],
          issued: { "date-parts": [[2025, 1, 1]] },
          "container-title": ["Journal of Tests"],
          abstract: "<jats:p>Remote abstract</jats:p>",
          subject: ["Testing"],
          DOI: "10.1234/example.5678",
          "is-referenced-by-count": 42,
          "references-count": 18,
          type: "journal-article",
          publisher: "Test Publisher",
          indexed: { "date-time": "2026-08-21T00:00:00Z" },
          URL: "https://doi.org/10.1234/example.5678"
        }
      }
    };
  };
  const crossref = await plugin.lookupPaperMetadata(localMetadata);
  assert.equal(crossref.source, "Crossref");
  assert.equal(crossref.title, "Accurate paper title from metadata");
  assert.equal(crossref.authors[0], "Lovelace, Ada");
  assert.equal(crossref.abstract, "Remote abstract");

  requestUrlMock = async () => ({
    json: { message: {
      title: ["Attention Is All You Need"],
      author: [{ given: "Ashish", family: "Vaswani" }],
      issued: { "date-parts": [[2025]] },
      "container-title": [],
      publisher: "Shenzhen Medical Academy of Research and Translation",
      type: "posted-content",
      DOI: "10.65215/2q58a426"
    } }
  });
  const postedContent = await plugin.lookupCrossref({ doi: "10.65215/2q58a426" });
  assert.equal(postedContent.venue, "");
  assert.equal(postedContent.publicationType, "posted-content");
  const publishedPaper = { doi: "", venue: "NIPS", year: 2017 };
  plugin.applyPublishedCrossrefMetadata(publishedPaper, {
    DOI: "10.65215/2q58a426",
    publisher: "Shenzhen Medical Academy of Research and Translation",
    type: "posted-content"
  }, [2025]);
  assert.deepEqual(publishedPaper, { doi: "", venue: "NIPS", year: 2017 });

  const mergedAttention = plugin.mergePaperMetadata(
    { title: "Attention Is All You Need", authors: [], year: 2017, venue: "NIPS", doi: "", arxiv: "1706.03762", tags: [] },
    { title: "Attention Is All You Need", authors: ["Ashish Vaswani"], year: 2025, venue: "arXiv", doi: "10.65215/2q58a426", arxiv: "1706.03762", tags: [], publicationType: "preprint" }
  );
  assert.equal(mergedAttention.year, 2017);
  assert.equal(mergedAttention.venue, "NIPS");
  assert.equal(mergedAttention.doi, "");

  const priorityPlugin = createPlugin();
  priorityPlugin.lookupArxiv = async () => ({
    source: "arXiv",
    title: "Published paper with a preprint",
    authors: ["Preprint Author"],
    year: 2023,
    venue: "arXiv",
    doi: "10.5555/published.123",
    arxiv: "2301.01234"
  });
  priorityPlugin.lookupCrossref = async ({ doi }) => doi ? ({
    source: "Crossref",
    title: "Published paper with a preprint",
    authors: ["Published Author"],
    year: 2024,
    venue: "Journal of Published Work",
    doi,
    arxiv: ""
  }) : null;
  const prioritized = await priorityPlugin.lookupPaperMetadata({
    title: "Published paper with a preprint",
    authors: [], year: 2023, venue: "", abstract: "", tags: [], doi: "", arxiv: "2301.01234"
  });
  assert.equal(prioritized.venue, "Journal of Published Work");
  assert.equal(prioritized.doi, "10.5555/published.123");
  assert.equal(prioritized.arxiv, "2301.01234");

  let normalizedRematchDoi = "";
  const doiRematchPlugin = createPlugin();
  doiRematchPlugin.lookupCrossref = async ({ doi }) => {
    normalizedRematchDoi = doi;
    return doi ? {
      source: "Crossref", title: "Corrected DOI paper", authors: [], year: 2025,
      venue: "Correct Journal", abstract: "", tags: [], doi, arxiv: ""
    } : null;
  };
  const doiRematch = await doiRematchPlugin.rematchPaperMetadata({
    title: "Previously incorrect title",
    doi: "https://doi.org/10.9999/CORRECT.123",
    arxiv: ""
  });
  assert.equal(normalizedRematchDoi, "10.9999/correct.123");
  assert.equal(doiRematch.venue, "Correct Journal");

  let titleOnlyQuery = null;
  const titleOnlyPlugin = createPlugin();
  titleOnlyPlugin.lookupCrossref = async (query) => {
    titleOnlyQuery = query;
    return query.title ? {
      source: "Crossref", title: query.title, authors: [], year: 2025,
      venue: "Title Matched Journal", abstract: "", tags: [], doi: "10.8888/by-title", arxiv: ""
    } : null;
  };
  const titleOnlyRematch = await titleOnlyPlugin.rematchPaperMetadata({
    title: "Corrected manual title", doi: "10.0000/stale-doi", arxiv: "", matchBy: "title"
  });
  assert.deepEqual(titleOnlyQuery, { title: "Corrected manual title" });
  assert.equal(titleOnlyRematch.venue, "Title Matched Journal");

  const titleRematchPlugin = createPlugin();
  titleRematchPlugin.lookupCrossref = async () => null;
  titleRematchPlugin.resolveOpenAlexWork = async () => ({
    id: "https://openalex.org/W-rematch",
    display_name: "Manually corrected paper title",
    publication_year: 2024,
    primary_location: { source: { display_name: "Correct Conference" } },
    authorships: [{ author: { display_name: "Correct Author" } }],
    topics: [{ display_name: "Metadata matching" }],
    doi: "https://doi.org/10.7777/rematched"
  });
  const titleRematch = await titleRematchPlugin.rematchPaperMetadata({
    title: "Manually corrected paper title", doi: "", arxiv: "2401.12345"
  });
  assert.equal(titleRematch.source, "OpenAlex");
  assert.equal(titleRematch.venue, "Correct Conference");
  assert.equal(titleRematch.doi, "10.7777/rematched");
  assert.equal(titleRematch.arxiv, "2401.12345");

  requestUrlMock = async () => ({
    json: { message: {
      title: ["Accurate paper title from metadata"],
      issued: { "date-parts": [[2025, 1, 1]] },
      "container-title": ["Journal of Tests"],
      DOI: "10.1234/example.5678",
      "is-referenced-by-count": 42,
      "references-count": 18,
      type: "journal-article",
      publisher: "Test Publisher"
    } }
  });
  plugin.metricsLoading = new Set();
  plugin.refreshViews = () => {};
  plugin.settings.papers[0].doi = "10.1234/example.5678";
  const metrics = await plugin.loadPaperMetrics(plugin.settings.papers[0], true);
  assert.equal(metrics.status, "ready");
  assert.equal(metrics.citations, 42);
  assert.equal(metrics.references, 18);
  assert.equal(metrics.type, "journal article");

  requestUrlMock = async (options) => {
    assert.match(options.url, /query\.bibliographic=Attention%20Is%20All%20You%20Need/);
    return { json: { message: { items: [{
      title: ["Is Attention All You Need?"],
      DOI: "10.1007/978-3-031-84300-6_13",
      issued: { "date-parts": [[2025]] }
    }] } } };
  };
  const reorderedAttention = await plugin.requestCrossrefWork({ title: "Attention Is All You Need" });
  assert.equal(reorderedAttention, null);

  const arxivMetricsPlugin = createPlugin();
  arxivMetricsPlugin.metricsLoading = new Set();
  arxivMetricsPlugin.refreshViews = () => {};
  arxivMetricsPlugin.saveSettings = async () => {};
  arxivMetricsPlugin.settings.papers[0].doi = "";
  arxivMetricsPlugin.settings.papers[0].arxiv = "2003.08934";
  arxivMetricsPlugin.settings.papers[0].venue = "arXiv";
  arxivMetricsPlugin.settings.papers[0].year = 2020;
  arxivMetricsPlugin.requestCrossrefWork = async () => null;
  arxivMetricsPlugin.resolveOpenAlexWork = async () => ({
    id: "https://openalex.org/W123",
    doi: "https://doi.org/10.1000/published-version",
    display_name: "Published version of an arXiv paper",
    publication_year: 2021,
    type: "article",
    cited_by_count: 88,
    referenced_works_count: 37,
    updated_date: "2026-08-21",
    primary_location: { source: { display_name: "Conference on Published Work" } }
  });
  const arxivMetrics = await arxivMetricsPlugin.loadPaperMetrics(arxivMetricsPlugin.settings.papers[0], true);
  assert.equal(arxivMetrics.status, "ready");
  assert.equal(arxivMetrics.source, "OpenAlex");
  assert.equal(arxivMetrics.citations, 88);
  assert.equal(arxivMetricsPlugin.settings.papers[0].venue, "Conference on Published Work");
  assert.equal(arxivMetricsPlugin.settings.papers[0].doi, "10.1000/published-version");

  const attentionMetricsPlugin = createPlugin();
  attentionMetricsPlugin.metricsLoading = new Set();
  attentionMetricsPlugin.refreshViews = () => {};
  attentionMetricsPlugin.saveSettings = async () => {};
  Object.assign(attentionMetricsPlugin.settings.papers[0], {
    title: "Attention Is All You Need",
    doi: "",
    arxiv: "1706.03762",
    venue: "NIPS",
    year: 2017
  });
  attentionMetricsPlugin.requestCrossrefWork = async () => ({
    title: ["Attention Is All You Need"],
    issued: { "date-parts": [[2025]] },
    type: "posted-content",
    publisher: "Shenzhen Medical Academy of Research and Translation",
    DOI: "10.65215/2q58a426",
    "is-referenced-by-count": 0
  });
  attentionMetricsPlugin.resolveOpenAlexWork = async () => ({
    id: "https://openalex.org/W2626778328",
    doi: "https://doi.org/10.65215/2q58a426",
    display_name: "Attention Is All You Need",
    publication_year: 2025,
    type: "preprint",
    cited_by_count: 6659,
    referenced_works_count: 41,
    primary_location: { source: null }
  });
  const attentionMetrics = await attentionMetricsPlugin.loadPaperMetrics(
    attentionMetricsPlugin.settings.papers[0],
    true
  );
  assert.equal(attentionMetrics.source, "OpenAlex");
  assert.equal(attentionMetrics.citations, 6659);
  assert.equal(attentionMetrics.type, "conference paper");
  assert.equal(attentionMetrics.publishedYear, 2017);
  assert.equal(attentionMetrics.publisher, "NIPS");
  assert.equal(attentionMetrics.sourceUrl, "https://openalex.org/W2626778328");
  assert.equal(attentionMetricsPlugin.settings.papers[0].doi, "");

  const preprintPaper = { doi: "", venue: "NIPS", year: 2017 };
  plugin.applyPublishedOpenAlexMetadata(preprintPaper, {
    type: "preprint",
    doi: "https://doi.org/10.65215/2q58a426",
    publication_year: 2025,
    primary_location: { source: { display_name: "Shenzhen Medical Academy of Research and Translation" } }
  });
  assert.deepEqual(preprintPaper, { doi: "", venue: "NIPS", year: 2017 });

  plugin.settings.openAlexApiKey = "test-openalex-key";
  plugin.relationCache = new Map();
  plugin.relationLoading = new Set();
  requestUrlMock = async (options) => {
    assert.match(options.url, /api_key=test-openalex-key/);
    if (options.url.includes("/works/doi:")) {
      return { json: {
        id: "https://openalex.org/W1",
        display_name: "Accurate paper title from Crossref",
        cited_by_count: 2,
        referenced_works: ["https://openalex.org/W2", "https://openalex.org/W3"]
      } };
    }
    if (options.url.includes("filter=cites%3AW1")) {
      assert.match(options.url, /sort=publication_date%3Adesc/);
      return { json: { meta: { count: 2 }, results: [
        { id: "https://openalex.org/W4", display_name: "Citing work one", publication_year: 2026, authorships: [] },
        { id: "https://openalex.org/W5", display_name: "Citing work two", publication_year: 2025, authorships: [] }
      ] } };
    }
    if (options.url.includes("filter=openalex%3AW2%7CW3")) {
      return { json: { meta: { count: 2 }, results: [
        { id: "https://openalex.org/W2", display_name: "Reference one", publication_year: 2020, authorships: [] },
        { id: "https://openalex.org/W3", display_name: "Reference two", publication_year: 2019, authorships: [] }
      ] } };
    }
    throw new Error(`Unexpected OpenAlex request: ${options.url}`);
  };
  const relations = await plugin.loadPaperRelations(plugin.settings.papers[0], true);
  assert.equal(relations.status, "ready");
  assert.equal(relations.citedBy.total, 2);
  assert.equal(relations.citedBy.items[0].title, "Citing work one");
  assert.equal(relations.references.total, 2);
  assert.equal(relations.references.items[1].title, "Reference two");
  assert.equal(plugin.nextPaperRelationLimit(5, 3000), 20);
  assert.equal(plugin.nextPaperRelationLimit(20, 3000), 50);
  assert.equal(plugin.nextPaperRelationLimit(500, 3000), 1000);
  assert.equal(plugin.nextPaperRelationLimit(1000, 3000), 1000);

  const stagedItems = Array.from({ length: 5 }, (_, index) => ({ id: `W${index}`, title: `Loaded ${index}` }));
  plugin.relationCache.set("paper-test", {
    status: "ready",
    workId: "W1",
    citedBy: { total: 3000, items: stagedItems, visibleLimit: 5, cursor: "next-page", allLoaded: false }
  });
  requestUrlMock = async (options) => {
    assert.match(options.url, /per_page=15/);
    assert.match(options.url, /cursor=next-page/);
    return { json: {
      meta: { count: 3000, next_cursor: "page-after-20" },
      results: Array.from({ length: 15 }, (_, index) => ({
        id: `https://openalex.org/W${index + 10}`,
        display_name: `Citing work ${index + 10}`,
        authorships: []
      }))
    } };
  };
  await plugin.loadMorePaperRelation(plugin.settings.papers[0], "citedBy");
  const stagedRelation = plugin.relationCache.get("paper-test").citedBy;
  assert.equal(stagedRelation.visibleLimit, 20);
  assert.equal(stagedRelation.items.length, 20);
  assert.equal(stagedRelation.cursor, "page-after-20");
  plugin.collapsePaperRelation(plugin.settings.papers[0], "citedBy");
  assert.equal(stagedRelation.visibleLimit, 5);

  plugin.settings.collections = ["Old collection", "Keep"];
  plugin.settings.papers[0].collections = ["Old collection"];
  plugin.uiState = { scope: "collection:Old collection" };
  await plugin.renameCollection("Old collection", "Renamed collection");
  assert.deepEqual(plugin.settings.papers[0].collections, ["Renamed collection"]);
  assert.equal(plugin.uiState.scope, "collection:Renamed collection");
  await plugin.deleteCollection("Renamed collection");
  assert.deepEqual(plugin.settings.papers[0].collections, []);
  assert.equal(plugin.uiState.scope, "all");

  const migrationPlugin = Object.create(PaperLibraryPlugin.prototype);
  migrationPlugin.loadData = async () => ({
    papers: [
      { id: "paper-1", title: "Built-in demo", tags: ["image-denoising"], collections: ["DONN"] },
      { id: "user-paper", title: "My paper", tags: ["my-tag"], collections: ["My collection"] },
      {
        id: "user-attention",
        title: "Attention Is All You Need",
        year: 2025,
        venue: "Shenzhen Medical Academy of Research and Translation",
        doi: "10.65215/2q58a426",
        arxiv: "1706.03762",
        tags: [],
        collections: []
      },
      {
        id: "user-cached-metrics",
        title: "A confirmed conference paper",
        year: 2024,
        venue: "NeurIPS",
        doi: "",
        arxiv: "2401.12345",
        tags: [],
        collections: [],
        metrics: { status: "ready", type: "posted content" }
      }
    ],
    tags: ["image-denoising", "my-tag"],
    collections: ["DONN", "Optics", "My collection"],
    demoPdfMigrationVersion: 1
  });
  migrationPlugin.saveData = async (data) => { migrationPlugin.savedData = data; };
  await migrationPlugin.loadSettings();
  assert.deepEqual(
    migrationPlugin.settings.papers.map((paper) => paper.id),
    ["user-paper", "user-attention", "user-cached-metrics"]
  );
  assert.deepEqual(migrationPlugin.settings.tags, ["my-tag"]);
  assert.deepEqual(migrationPlugin.settings.collections, ["My collection"]);
  assert.equal(migrationPlugin.savedData.demoContentRemovalVersion, 1);
  const migratedAttention = migrationPlugin.settings.papers.find((paper) => paper.id === "user-attention");
  assert.equal(migratedAttention.doi, "");
  assert.equal(migratedAttention.venue, "NIPS");
  assert.equal(migratedAttention.year, 2017);
  assert.equal(migrationPlugin.savedData.publishedVenueRepairVersion, 1);
  assert.equal(migrationPlugin.settings.papers.find((paper) => paper.id === "user-cached-metrics").metrics, undefined);
  assert.equal(migrationPlugin.savedData.metricsPublicationTypeRepairVersion, 1);
  assert.equal(migrationPlugin.savedData.fileOrganizationMigrationVersion, 1);

  const hintPlugin = createPlugin();
  hintPlugin.settings.pdfAnnotationHintShown = false;
  hintPlugin.uiState = { activePdfPaperId: null };
  let pdfOpenCount = 0;
  hintPlugin.app.vault.getAbstractFileByPath = () => ({ path: "Papers/test.pdf", extension: "pdf" });
  hintPlugin.app.workspace.getLeaf = () => ({ openFile: async () => { pdfOpenCount += 1; } });
  hintPlugin.getPdfPlus = () => ({ enabled: true });
  hintPlugin.saveSettings = async () => {};
  const noticeCountBeforePdfOpen = notices.length;
  await hintPlugin.openPaperPdf(hintPlugin.settings.papers[0]);
  await hintPlugin.openPaperPdf(hintPlugin.settings.papers[0]);
  assert.equal(pdfOpenCount, 2);
  assert.equal(notices.length, noticeCountBeforePdfOpen + 1);
  assert.equal(hintPlugin.settings.pdfAnnotationHintShown, true);

  const vaultEntries = new Map();
  const importPlugin = createPlugin();
  importPlugin.settings.pdfsFolder = "Papers/PDFs";
  importPlugin.app.vault = {
    getAbstractFileByPath: (path) => vaultEntries.get(path) || null,
    createFolder: async (path) => { vaultEntries.set(path, { path, folder: true }); },
    createBinary: async (path, buffer) => { vaultEntries.set(path, { path, buffer }); }
  };
  const storedPath = await importPlugin.saveDroppedPdf(
    { name: "paper.pdf", buffer: new TextEncoder().encode("%PDF-test").buffer },
    "Papers/PDFs/paper.pdf"
  );
  assert.equal(storedPath, "Papers/PDFs/paper.pdf");
  assert.equal(vaultEntries.get(storedPath).buffer.byteLength, 9);

  const organizedEntries = new Map();
  const oldPdf = { path: "Papers/PDFs/attention.pdf", extension: "pdf" };
  const oldNote = { path: "Papers/Attention Is All You Need.md", extension: "md" };
  organizedEntries.set(oldPdf.path, oldPdf);
  organizedEntries.set(oldNote.path, oldNote);
  let organizedNoteContent = `---\npdf: "${oldPdf.path}"\n---\n\n[[${oldPdf.path}#page=1]]`;
  const organizationPlugin = createPlugin();
  organizationPlugin.settings.libraryFolder = "Papers";
  organizationPlugin.settings.notesFolder = "Papers";
  organizationPlugin.settings.pdfsFolder = "Papers/PDFs";
  organizationPlugin.app.vault = {
    getAbstractFileByPath: (path) => organizedEntries.get(path) || null,
    createFolder: async (path) => { organizedEntries.set(path, { path, folder: true }); },
    rename: async (file, target) => {
      organizedEntries.delete(file.path);
      file.path = target;
      organizedEntries.set(target, file);
    },
    read: async () => organizedNoteContent,
    modify: async (_file, content) => { organizedNoteContent = content; }
  };
  const attentionPaper = {
    title: "Attention Is All You Need",
    year: 2017,
    collections: ["Transformers", "NLP"],
    pdfPath: oldPdf.path,
    notePath: oldNote.path
  };
  await organizationPlugin.organizePaperFiles(attentionPaper);
  assert.equal(attentionPaper.pdfPath, "Papers/Transformers/2017/Attention Is All You Need.pdf");
  assert.equal(attentionPaper.notePath, "Papers/Transformers/2017/Attention Is All You Need.md");
  assert.ok(organizedEntries.has(attentionPaper.pdfPath));
  assert.ok(organizedEntries.has(attentionPaper.notePath));
  assert.match(organizedNoteContent, /Papers\/Transformers\/2017\/Attention Is All You Need\.pdf/);

  organizedEntries.set("Papers/Transformers/2017/Duplicate.pdf", { path: "Papers/Transformers/2017/Duplicate.pdf" });
  const availablePaths = organizationPlugin.getAvailableOrganizedPaperPaths({
    title: "Duplicate", year: 2017, collections: ["Transformers"]
  });
  assert.equal(availablePaths.pdfPath, "Papers/Transformers/2017/Duplicate-2.pdf");
  assert.equal(availablePaths.notePath, "Papers/Transformers/2017/Duplicate-2.md");

  process.stdout.write("Paper Library interaction tests passed\n");
}

run().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
