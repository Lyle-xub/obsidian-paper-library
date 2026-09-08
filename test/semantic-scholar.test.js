const assert = require("node:assert/strict");
const Module = require("node:module");

let requestUrlMock = async () => ({ json: {} });
const obsidianMock = {
  ItemView: class {},
  Menu: class {},
  Modal: class {},
  Notice: class {},
  Plugin: class {},
  PluginSettingTab: class {},
  Setting: class {},
  loadPdfJs: async () => null,
  normalizePath: (value) => value,
  requestUrl: (options) => requestUrlMock(options),
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
    semanticScholarApiKey: "test-key",
    metadataSource: "semantic-scholar",
    semanticScholarPaperCache: { papers: {}, aliases: {} }
  };
  plugin.semanticScholarRequestQueue = Promise.resolve();
  plugin.semanticScholarLastRequestAt = 0;
  plugin.semanticScholarPaperLookups = new Map();
  plugin.saveSettings = async () => {};
  return plugin;
}

async function run() {
  const plugin = createPlugin();
  plugin.settings.papers = [{ tags: ["Topic Modeling", "Computer-Science", "123"] }];
  plugin.settings.tags = ["Natural Language Processing Techniques", "topic-modeling"];
  assert.deepEqual(plugin.getAllTags(), [
    "Computer-Science",
    "Natural-Language-Processing-Techniques",
    "topic-modeling"
  ]);
  assert.deepEqual(plugin.mapSemanticScholarPaper({
    paperId: "tag-paper",
    title: "Valid Obsidian tags",
    fieldsOfStudy: ["Computer Science", "Speech Recognition and Synthesis"]
  }).tags, ["Computer-Science", "Speech-Recognition-and-Synthesis"]);

  assert.equal(
    plugin.semanticScholarSearchQuery("Prism:Cost-Efficient Multi-LLM Serving via GPU Memory Ballooning"),
    "Prism Cost Efficient Multi LLM Serving via GPU Memory Ballooning"
  );

  const parsedSerp = plugin.parseSerpApiGoogleScholarResults({
    organic_results: [{
      result_id: "serp-result",
      title: "A SerpApi Paper",
      link: "https://example.com/paper",
      publication_info: {
        summary: "Ada LovelaceProceedings of MLSys, 2025•example.com",
        authors: [{ name: "Ada Lovelace" }]
      },
      inline_links: { cited_by: { total: 42, cites_id: "serp-cites" } }
    }]
  }, { title: "A SerpApi Paper", authors: ["Ada Lovelace"] });
  assert.equal(parsedSerp.citationCount, 42);
  assert.equal(parsedSerp.serpApiCitesId, "serp-cites");
  assert.equal(parsedSerp.publicationType, "conference-paper");

  const looseSerpPlugin = createPlugin();
  looseSerpPlugin.settings.serpApiKey = "serp-key";
  let scholarQuery = "";
  looseSerpPlugin.requestSerpApiGoogleScholar = async (params) => {
    scholarQuery = params.q;
    return {
      organic_results: [{
        result_id: "tenet-result",
        title: "TENET-v2: Applying Relation-Centric Notation to Model and Optimize Data Swizzle in the Cache of Modern NPU",
        link: "https://ieeexplore.ieee.org/abstract/document/11408572/",
        publication_info: {
          summary: "H Zhang, F Guo, L Lu - IEEE International Symposium on High-Performance Computer Architecture, 2026",
          authors: [{ name: "H Zhang" }, { name: "F Guo" }, { name: "L Lu" }]
        },
        inline_links: {}
      }]
    };
  };
  const tenetSerp = await looseSerpPlugin.lookupGoogleScholarViaSerpApi({
    title: "TENET-v2: Applying Relation-Centric Notation to Model and Optimize Data Swizzle in the Cache of Modern NPU",
    authors: ["Zhang, Hanyu", "Guo, Fangxu"]
  });
  assert.equal(scholarQuery.includes('"'), false);
  assert.equal(scholarQuery, "TENET v2 Applying Relation Centric Notation to Model and Optimize Data Swizzle in the Cache of Modern NPU");
  assert.equal(tenetSerp.serpApiResultId, "tenet-result");

  let searchQuery = "";
  plugin.requestSemanticScholar = async (path, params) => {
    assert.equal(path, "/paper/search");
    searchQuery = params.query;
    return {
      data: [{
        paperId: "2ca170c31d6df89993558f0784b5eef7244cf7b7",
        title: "Prism: Cost-Efficient Multi-LLM Serving via GPU Memory Ballooning",
        year: 2025,
        citationCount: 27,
        referenceCount: 59,
        authors: [{ name: "Shan Yu" }, { name: "Jiarong Xing" }]
      }]
    };
  };
  const match = await plugin.resolveSemanticScholarPaper({
    title: "Prism:Cost-Efficient Multi-LLM Serving via GPU Memory Ballooning",
    year: 2026,
    authors: ["Shan Yu", "Jiarong Xing"]
  });
  assert.equal(searchQuery, "Prism Cost Efficient Multi LLM Serving via GPU Memory Ballooning");
  assert.equal(match.paperId, "2ca170c31d6df89993558f0784b5eef7244cf7b7");

  let directIdentifier = "";
  plugin.requestSemanticScholar = async (path) => {
    directIdentifier = path;
    return { paperId: "stable-paper-id", title: "Stable paper" };
  };
  const directMatch = await plugin.resolveSemanticScholarPaper({
    paperId: "stable-paper-id",
    title: "A title that no longer needs fuzzy matching"
  });
  assert.equal(directIdentifier, "/paper/stable-paper-id");
  assert.equal(directMatch.paperId, "stable-paper-id");

  const cachePlugin = createPlugin();
  cachePlugin.scheduleSemanticScholarCacheSave = () => {};
  let cacheRequests = 0;
  cachePlugin.requestSemanticScholar = async () => {
    cacheRequests += 1;
    return {
      paperId: "tmac-semantic-id",
      title: "T-MAC: CPU Renaissance via Table Lookup for Low-Bit LLM Deployment on Edge",
      abstract: "Cached Semantic Scholar abstract",
      externalIds: { DOI: "10.1145/3689031.3696099", ArXiv: "2407.00088" }
    };
  };
  const tmacLookup = {
    doi: "10.1145/3689031.3696099",
    title: "T-MAC: CPU Renaissance via Table Lookup for Low-Bit LLM Deployment on Edge"
  };
  const [firstTmac, concurrentTmac] = await Promise.all([
    cachePlugin.resolveSemanticScholarPaper(tmacLookup),
    cachePlugin.resolveSemanticScholarPaper(tmacLookup)
  ]);
  assert.equal(firstTmac.abstract, "Cached Semantic Scholar abstract");
  assert.equal(concurrentTmac.paperId, "tmac-semantic-id");
  assert.equal(cacheRequests, 1);
  const cachedTmac = await cachePlugin.resolveSemanticScholarPaper(tmacLookup);
  assert.equal(cachedTmac.abstract, "Cached Semantic Scholar abstract");
  assert.equal(cacheRequests, 1);

  const relationPlugin = createPlugin();
  let inFlight = false;
  let overlapped = false;
  const order = [];
  const initialLimits = [];
  relationPlugin.fetchSemanticScholarRelationPage = async (_paperId, endpoint, _offset, limit) => {
    if (inFlight) overlapped = true;
    inFlight = true;
    order.push(endpoint);
    initialLimits.push(limit);
    await Promise.resolve();
    inFlight = false;
    return { items: [], hasMore: false };
  };
  await relationPlugin.loadSemanticScholarRelations("paper-id", 27, 59);
  assert.equal(overlapped, false);
  assert.deepEqual(order, ["citations", "references"]);
  assert.deepEqual(initialLimits, [100, 100]);

  const staleRelations = {
    status: "ready",
    provider: "semantic-scholar",
    citedBy: {
      total: 0,
      items: Array.from({ length: 5 }, (_, index) => ({ id: `c-${index}`, title: `Citation ${index}` })),
      visibleLimit: 5,
      allLoaded: false
    },
    references: {
      total: 0,
      items: Array.from({ length: 5 }, (_, index) => ({ id: `r-${index}`, title: `Reference ${index}` })),
      visibleLimit: 5,
      allLoaded: false
    }
  };
  assert.equal(relationPlugin.reconcilePaperRelationTotals({
    metrics: { source: "Crossref", citations: 122, references: 89 }
  }, staleRelations), true);
  assert.equal(staleRelations.citedBy.total, 122);
  assert.equal(staleRelations.references.total, 89);
  assert.equal(relationPlugin.paperRelationCountLabel(staleRelations.citedBy), "122");
  assert.equal(relationPlugin.nextPaperRelationLimit(
    5,
    relationPlugin.paperRelationPaginationTotal(staleRelations.citedBy)
  ), 20);

  const unknownRelations = {
    status: "ready",
    citedBy: {
      total: 0,
      items: Array.from({ length: 5 }, (_, index) => ({ id: `u-${index}`, title: `Unknown ${index}` })),
      visibleLimit: 5,
      allLoaded: false
    }
  };
  relationPlugin.reconcilePaperRelationTotals({ metrics: { citations: 0 } }, unknownRelations);
  assert.equal(relationPlugin.paperRelationCountLabel(unknownRelations.citedBy), "5+");
  assert.equal(relationPlugin.paperRelationPaginationTotal(unknownRelations.citedBy), 1000);

  const restrictedPlugin = createPlugin();
  restrictedPlugin.requestSemanticScholar = async (path) => path.endsWith("/references")
    ? {
      data: null,
      citingPaperInfo: {
        openAccessPdf: {
          disclaimer: "The following paper fields have been elided by the publisher: {'references'}."
        }
      }
    }
    : { data: [] };
  const restrictedRelations = await restrictedPlugin.loadSemanticScholarRelations("tenet-semantic-id", 0, 65);
  assert.equal(restrictedRelations.references.total, 65);
  assert.equal(restrictedRelations.references.items.length, 0);
  assert.equal(restrictedRelations.references.loadFailed, true);
  assert.equal(restrictedRelations.references.allLoaded, false);
  assert.match(restrictedRelations.references.unavailableReason, /elided by the publisher/);
  restrictedPlugin.resolveOpenAlexWork = async () => ({
    id: "https://openalex.org/W-TENET",
    cited_by_count: 0,
    referenced_works: ["https://openalex.org/W-R1", "https://openalex.org/W-R2"]
  });
  restrictedPlugin.requestOpenAlex = async (_path, params) => params.filter.startsWith("cites:")
    ? { meta: { count: 0, next_cursor: "" }, results: [] }
    : { results: [
      { id: "https://openalex.org/W-R1", display_name: "Recovered reference one", authorships: [] },
      { id: "https://openalex.org/W-R2", display_name: "Recovered reference two", authorships: [] }
    ] };
  const recoveredRelations = await restrictedPlugin.supplementUnavailableSemanticRelations({
    id: "tenet", title: "TENET-v2", doi: "10.1109/hpca68181.2026.11408572"
  }, restrictedRelations);
  assert.equal(recoveredRelations.references.provider, "openalex");
  assert.equal(recoveredRelations.references.fallbackFrom, "semantic-scholar");
  assert.equal(recoveredRelations.references.total, 65);
  assert.equal(recoveredRelations.references.items.length, 2);
  assert.equal(recoveredRelations.references.items[0].title, "Recovered reference one");
  assert.equal(restrictedPlugin.paperRelationCountLabel(recoveredRelations.references), "65");
  assert.equal(restrictedPlugin.paperRelationPaginationTotal(recoveredRelations.references), 2);
  assert.equal(restrictedPlugin.paperRelationsNeedRecovery({
    status: "ready",
    references: { provider: "semantic-scholar", total: 65, items: [], allLoaded: true }
  }), true);

  const retryPlugin = createPlugin();
  retryPlugin.semanticScholarDelay = async () => {};
  let attempts = 0;
  requestUrlMock = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("Request failed, status 429");
    return { json: { paperId: "retry-ok" } };
  };
  const retried = await retryPlugin.requestSemanticScholar("/paper/retry-test");
  assert.equal(retried.paperId, "retry-ok");
  assert.equal(attempts, 2);
  assert.equal(retryPlugin.semanticScholarErrorStatus(new Error("Request failed, status 429")), 429);

  assert.equal(
    retryPlugin.createSemanticScholarMetrics({
      paperId: "osdi-paper",
      title: "Prism: Cost-Efficient Multi-LLM Serving via GPU Memory Ballooning",
      citationCount: 27,
      referenceCount: 59,
      publicationTypes: []
    }, {
      title: "Prism:Cost-Efficient Multi-LLM Serving via GPU Memory Ballooning",
      venue: "OSDI",
      year: 2026
    }).type,
    "conference paper"
  );

  assert.equal(
    retryPlugin.createSemanticScholarMetrics({
      paperId: "mlsys-paper",
      title: "MLSys venue must override a broad provider type",
      venue: "Conference on Machine Learning and Systems",
      publicationTypes: ["JournalArticle"]
    }, {
      title: "MLSys venue must override a broad provider type",
      venue: "MLSys",
      year: 2025
    }).type,
    "conference paper"
  );

  assert.equal(
    retryPlugin.createSemanticScholarMetrics({
      paperId: "hpca-paper",
      title: "HPCA venue must override a broad provider type",
      venue: "International Symposium on High-Performance Computer Architecture",
      publicationTypes: ["JournalArticle"]
    }, {
      title: "HPCA venue must override a broad provider type",
      venue: "arXiv",
      arxiv: "2601.00001",
      year: 2026
    }).type,
    "conference paper"
  );

  assert.equal(
    retryPlugin.mapSemanticScholarPaper({
      paperId: "hpca-metadata",
      title: "HPCA metadata classification",
      venue: "International Symposium on High-Performance Computer Architecture",
      publicationTypes: ["JournalArticle", "Preprint"],
      authors: []
    }).publicationType,
    "conference-paper"
  );

  assert.equal(
    retryPlugin.createOpenAlexMetrics({
      type: "proceedings-article",
      primary_location: { source: { display_name: "International Symposium on High-Performance Computer Architecture" } }
    }, {
      title: "Provider venue classification",
      venue: "arXiv",
      arxiv: "2601.00002"
    }).type,
    "conference paper"
  );

  assert.equal(
    retryPlugin.createSemanticScholarMetrics({
      paperId: "repository-paper",
      title: "Repository record must remain a preprint",
      venue: "arXiv.org",
      publicationTypes: ["JournalArticle"]
    }, {
      title: "Repository record must remain a preprint",
      venue: "arXiv",
      arxiv: "2601.00003"
    }).type,
    "preprint"
  );

  const cachedRelationPlugin = createPlugin();
  cachedRelationPlugin.relationCache = new Map();
  cachedRelationPlugin.relationLoading = new Set();
  cachedRelationPlugin.refreshViews = () => {};
  cachedRelationPlugin.resolveSemanticScholarPaper = async () => {
    throw new Error("cached paperId should skip paper resolution");
  };
  cachedRelationPlugin.loadSemanticScholarRelations = async (paperId, citations, references) => ({
    status: "ready", provider: "semantic-scholar", workId: paperId, citations, references
  });
  const cachedRelations = await cachedRelationPlugin.loadPaperRelations({
    id: "prism",
    semanticScholarPaperId: "2ca170c31d6df89993558f0784b5eef7244cf7b7",
    metrics: { source: "Crossref", citations: 27, references: 59 }
  }, true);
  assert.equal(cachedRelations.workId, "2ca170c31d6df89993558f0784b5eef7244cf7b7");
  assert.equal(cachedRelations.citations, 27);
  assert.equal(cachedRelations.references, 59);

  const serpModePlugin = createPlugin();
  serpModePlugin.settings.metadataSource = "serpapi";
  serpModePlugin.settings.serpApiKey = "serp-key";
  serpModePlugin.metricsLoading = new Set();
  serpModePlugin.refreshViews = () => {};
  serpModePlugin.lookupDefaultPaperMetadata = async () => {
    throw new Error("SerpApi-only mode must not call the default metadata chain");
  };
  serpModePlugin.lookupGoogleScholarViaSerpApi = async () => ({
    source: "Google Scholar · SerpApi",
    title: "SerpApi primary paper",
    authors: ["Ada Lovelace"],
    year: 2025,
    venue: "MLSys",
    abstract: "",
    tags: [],
    doi: "",
    arxiv: "",
    publicationType: "conference-paper",
    sourceUrl: "https://example.com/serp-paper",
    serpApiResultId: "serp-primary",
    serpApiCitesId: "serp-primary-cites",
    citationCount: 42
  });
  serpModePlugin.resolveSemanticScholarPaper = async () => ({
    paperId: "semantic-reference-id",
    referenceCount: 17
  });
  const serpMetadata = await serpModePlugin.lookupPaperMetadata({
    title: "SerpApi primary paper", authors: ["Ada Lovelace"], year: 0, venue: "", abstract: "", tags: []
  });
  assert.equal(serpMetadata.source, "Google Scholar · SerpApi");
  const serpPaper = { id: "serp-mode", title: "SerpApi primary paper", authors: ["Ada Lovelace"], year: 0, venue: "" };
  const serpMetrics = await serpModePlugin.loadPaperMetrics(serpPaper, true);
  assert.equal(serpMetrics.citations, 42);
  assert.equal(serpMetrics.references, 0);
  assert.equal(serpMetrics.type, "conference paper");
  assert.equal(serpMetrics.source, "SerpApi");

  serpModePlugin.fetchSerpApiCitationPage = async () => ({
    items: [{ id: "citing", title: "A citing paper", authors: [], venue: "", year: 2026, url: "" }],
    total: 42,
    hasMore: true
  });
  serpModePlugin.fetchSemanticScholarRelationPage = async () => ({
    items: [{ id: "reference", title: "A reference", authors: [], venue: "", year: 2024, url: "" }],
    hasMore: true
  });
  const mixedRelations = await serpModePlugin.loadSerpApiRelations(serpPaper);
  assert.equal(mixedRelations.citedBy.provider, "serpapi");
  assert.equal(mixedRelations.citedBy.total, 42);
  assert.equal(mixedRelations.references.provider, "semantic-scholar");
  assert.equal(mixedRelations.references.total, 17);
  assert.equal(serpPaper.metrics.references, 17);
  assert.equal(serpPaper.metrics.source, "SerpApi + Semantic Scholar（参考文献）");
  assert.equal(serpPaper.semanticScholarPaperId, "semantic-reference-id");

  const prefetchPlugin = createPlugin();
  prefetchPlugin.relationCache = new Map();
  prefetchPlugin.relationLoading = new Set();
  prefetchPlugin.refreshViews = () => {};
  let persistedPrefetches = 0;
  prefetchPlugin.saveSettings = async () => { persistedPrefetches += 1; };
  const prefetchPaper = {
    id: "semantic-prefetch",
    metrics: { citations: 122, references: 89 }
  };
  prefetchPlugin.relationCache.set(prefetchPaper.id, {
    status: "ready",
    provider: "semantic-scholar",
    workId: "semantic-prefetch-id",
    semanticScholarPaperId: "semantic-prefetch-id",
    updatedAt: new Date().toISOString(),
    citedBy: {
      provider: "semantic-scholar",
      total: 122,
      totalKnown: true,
      items: Array.from({ length: 5 }, (_, index) => ({ id: `old-${index}`, title: `Old ${index}` })),
      visibleLimit: 5,
      nextOffset: 5,
      allLoaded: false
    }
  });
  let prefetchLimit = 0;
  prefetchPlugin.fetchSemanticScholarRelationPage = async (_paperId, _endpoint, offset, limit) => {
    assert.equal(offset, 5);
    prefetchLimit = limit;
    return {
      items: Array.from({ length: 95 }, (_, index) => ({ id: `new-${index}`, title: `New ${index}` })),
      hasMore: true,
      nextOffset: 100
    };
  };
  await prefetchPlugin.loadMorePaperRelation(prefetchPaper, "citedBy");
  const prefetched = prefetchPlugin.relationCache.get(prefetchPaper.id).citedBy;
  assert.equal(prefetchLimit, 100);
  assert.equal(prefetched.items.length, 100);
  assert.equal(prefetched.visibleLimit, 20);
  assert.equal(prefetchPaper.relations.citedBy.items.length, 100);
  assert.equal(persistedPrefetches, 1);

  const backgroundPlugin = createPlugin();
  backgroundPlugin.relationCache = new Map();
  backgroundPlugin.relationLoading = new Set();
  backgroundPlugin.semanticRelationPrefetches = new Map();
  backgroundPlugin.refreshViews = () => {};
  let backgroundSaves = 0;
  backgroundPlugin.saveSettings = async () => { backgroundSaves += 1; };
  const backgroundPaper = { id: "background-cache", metrics: { citations: 205, references: 0 } };
  const backgroundRelations = {
    status: "ready",
    provider: "semantic-scholar",
    workId: "background-semantic-id",
    semanticScholarPaperId: "background-semantic-id",
    updatedAt: new Date().toISOString(),
    citedBy: {
      provider: "semantic-scholar",
      total: 205,
      totalKnown: true,
      items: Array.from({ length: 100 }, (_, index) => ({ id: `cached-${index}`, title: `Cached ${index}` })),
      visibleLimit: 5,
      nextOffset: 100,
      allLoaded: false
    }
  };
  backgroundPlugin.relationCache.set(backgroundPaper.id, backgroundRelations);
  const backgroundOffsets = [];
  backgroundPlugin.fetchSemanticScholarRelationPage = async (_paperId, _endpoint, offset, limit) => {
    backgroundOffsets.push(offset);
    assert.equal(limit, 100);
    const size = offset === 100 ? 100 : 5;
    return {
      items: Array.from({ length: size }, (_, index) => ({
        id: `cached-${offset + index}`,
        title: `Cached ${offset + index}`
      })),
      hasMore: offset === 100,
      nextOffset: offset + size
    };
  };
  await backgroundPlugin.prefetchSemanticScholarRelationCache(backgroundPaper, backgroundRelations);
  assert.deepEqual(backgroundOffsets, [100, 200]);
  assert.equal(backgroundRelations.citedBy.items.length, 205);
  assert.equal(backgroundRelations.citedBy.allLoaded, true);
  assert.equal(backgroundPaper.relations.citedBy.items.length, 205);
  assert.equal(backgroundSaves, 2);

  const relationFallbackPlugin = createPlugin();
  relationFallbackPlugin.relationCache = new Map();
  relationFallbackPlugin.relationLoading = new Set();
  relationFallbackPlugin.refreshViews = () => {};
  relationFallbackPlugin.resolveSemanticScholarPaper = async () => {
    throw new Error("Request failed, status 429");
  };
  relationFallbackPlugin.resolveOpenAlexWork = async () => ({
    id: "https://openalex.org/W-FALLBACK",
    cited_by_count: 1,
    referenced_works: ["https://openalex.org/W-REFERENCE"]
  });
  relationFallbackPlugin.requestOpenAlex = async (_path, params) => params.filter.startsWith("cites:")
    ? { meta: { count: 1, next_cursor: "" }, results: [{ id: "W-CITING", display_name: "Fallback citing paper" }] }
    : { results: [{ id: "https://openalex.org/W-REFERENCE", display_name: "Fallback reference" }] };
  const fallbackRelations = await relationFallbackPlugin.loadPaperRelations({
    id: "crossref-fallback",
    title: "Crossref paper with Semantic Scholar throttling",
    authors: [],
    metrics: { source: "Crossref", citations: 1, references: 1 }
  }, true);
  assert.equal(fallbackRelations.workId, "W-FALLBACK");
  assert.equal(fallbackRelations.citedBy.items[0].title, "Fallback citing paper");

  const persistentRelationPlugin = createPlugin();
  persistentRelationPlugin.relationCache = new Map();
  persistentRelationPlugin.relationLoading = new Set();
  persistentRelationPlugin.refreshViews = () => {};
  let relationReloads = 0;
  let relationSaves = 0;
  persistentRelationPlugin.saveSettings = async () => { relationSaves += 1; };
  persistentRelationPlugin.loadSemanticScholarRelations = async (paperId) => {
    relationReloads += 1;
    return {
      status: "ready",
      provider: "semantic-scholar",
      workId: paperId,
      updatedAt: new Date().toISOString(),
      citedBy: { total: 1, items: [], visibleLimit: 5, allLoaded: true },
      references: { total: 1, items: [], visibleLimit: 5, allLoaded: true }
    };
  };
  const persistentPaper = {
    id: "persistent-relations",
    semanticScholarPaperId: "persistent-paper-id",
    metrics: { source: "Semantic Scholar", citations: 1, references: 1 },
    relations: {
      status: "ready",
      provider: "semantic-scholar",
      workId: "persistent-paper-id",
      updatedAt: new Date(Date.now() - 47 * 60 * 60 * 1000).toISOString(),
      citedBy: { total: 1, items: [], visibleLimit: 5, allLoaded: true },
      references: { total: 1, items: [], visibleLimit: 5, allLoaded: true }
    }
  };
  const freshRelations = await persistentRelationPlugin.loadPaperRelations(persistentPaper);
  assert.equal(freshRelations.workId, "persistent-paper-id");
  assert.equal(relationReloads, 0);
  assert.equal(relationSaves, 1);
  await persistentRelationPlugin.loadPaperRelations(persistentPaper, true);
  assert.equal(relationReloads, 1);
  assert.equal(relationSaves, 2);
  assert.ok(Date.parse(persistentPaper.relations.updatedAt) > Date.now() - 60_000);
  persistentPaper.relations.updatedAt = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();
  persistentRelationPlugin.relationCache.clear();
  await persistentRelationPlugin.loadPaperRelations(persistentPaper);
  assert.equal(relationReloads, 2);
  assert.equal(relationSaves, 3);

  const restoredRelationPlugin = createPlugin();
  restoredRelationPlugin.settings.papers = [persistentPaper];
  restoredRelationPlugin.relationCache = new Map();
  restoredRelationPlugin.restorePaperRelationCache();
  assert.equal(restoredRelationPlugin.relationCache.get(persistentPaper.id).workId, "persistent-paper-id");

  const completePrimaryPlugin = createPlugin();
  let completeSemanticCalls = 0;
  completePrimaryPlugin.lookupDefaultPaperMetadata = async () => ({
    source: "Crossref",
    title: "Complete default record",
    authors: ["Ada Lovelace"],
    year: 2025,
    venue: "OSDI",
    abstract: "A".repeat(120),
    tags: [],
    doi: "10.1234/complete",
    arxiv: "",
    publicationType: "conference-paper"
  });
  completePrimaryPlugin.resolveSemanticScholarPaper = async () => {
    completeSemanticCalls += 1;
    return {
      paperId: "complete-semantic-id",
      title: "Complete default record",
      authors: [{ name: "Ada Lovelace" }],
      year: 2025,
      venue: "OSDI",
      abstract: "This abstract comes directly from Semantic Scholar even though the primary Crossref record already contains an abstract.",
      externalIds: { DOI: "10.1234/complete" }
    };
  };
  const completePrimary = await completePrimaryPlugin.lookupPaperMetadata({
    title: "Complete default record", authors: [], year: 0, venue: "", abstract: "", tags: [], doi: "", arxiv: ""
  });
  assert.equal(completePrimary.source, "Crossref + Semantic Scholar");
  assert.equal(completePrimary.abstractSource, "Semantic Scholar");
  assert.match(completePrimary.abstract, /directly from Semantic Scholar/);
  assert.equal(completeSemanticCalls, 1);

  const throttledAbstractPlugin = createPlugin();
  throttledAbstractPlugin.lookupDefaultPaperMetadata = async () => ({
    source: "Crossref",
    title: "T-MAC: CPU Renaissance via Table Lookup for Low-Bit LLM Deployment on Edge",
    authors: ["Jianyu Wei"],
    year: 2025,
    venue: "Proceedings of the Twentieth European Conference on Computer Systems",
    abstract: "",
    tags: [],
    doi: "10.1145/3689031.3696099",
    arxiv: "2407.00088",
    publicationType: "conference-paper"
  });
  throttledAbstractPlugin.resolveSemanticScholarPaper = async () => {
    throw new Error("Request failed, status 429");
  };
  throttledAbstractPlugin.resolveOpenAlexWork = async ({ doi }) => {
    assert.equal(doi, "10.1145/3689031.3696099");
    return { abstract_inverted_index: { Exact: [0], fallback: [1], abstract: [2] } };
  };
  const throttledAbstract = await throttledAbstractPlugin.lookupPaperMetadata({
    title: "T-MAC: CPU Renaissance via Table Lookup for Low-Bit LLM Deployment on Edge",
    authors: ["Jianyu Wei"], year: 2025, venue: "", abstract: [],
    doi: "10.1145/3689031.3696099", arxiv: "2407.00088"
  });
  assert.equal(throttledAbstract.abstract, "Exact fallback abstract");
  assert.equal(throttledAbstract.abstractSource, "OpenAlex");

  assert.equal(typeof completePrimaryPlugin.extractAbstractFromPdfText, "undefined");
  assert.equal(typeof completePrimaryPlugin.extractDocLayoutAbstract, "undefined");
  const refreshPlugin = createPlugin();
  refreshPlugin.infoLoading = new Set();
  refreshPlugin.refreshViews = () => {};
  refreshPlugin.app = {
    vault: {
      getAbstractFileByPath: () => ({ extension: "pdf", name: "paper.pdf" }),
      readBinary: async () => new ArrayBuffer(4)
    }
  };
  refreshPlugin.extractLocalPdfMetadata = async () => ({
    title: "Semantic abstract refresh",
    authors: ["Ada Lovelace"],
    year: 2025,
    venue: "OSDI",
    abstract: "An incorrect locally guessed abstract.",
    tags: [], doi: "10.1234/semantic-abstract", arxiv: ""
  });
  refreshPlugin.lookupPaperMetadata = async (input) => {
    assert.equal(input.title, "Semantic abstract refresh");
    return {
      source: "Crossref + Semantic Scholar",
      title: input.title,
      authors: input.authors,
      year: input.year,
      venue: input.venue,
      abstract: "The authoritative abstract returned by Semantic Scholar.",
      abstractSource: "Semantic Scholar",
      paperId: "refresh-semantic-id",
      tags: [], doi: input.doi, arxiv: ""
    };
  };
  refreshPlugin.enrichPaperVenueRanks = async () => {};
  const refreshPaper = {
    id: "refresh-paper",
    title: "Semantic abstract refresh",
    authors: ["Ada Lovelace"],
    year: 2025,
    venue: "OSDI",
    abstract: "Old abstract",
    tags: [], doi: "10.1234/semantic-abstract", arxiv: "",
    pdfPath: "Papers/paper.pdf"
  };
  refreshPlugin.settings.onlineMetadataLookup = true;
  await refreshPlugin.refreshPaperInfo(refreshPaper);
  assert.equal(refreshPaper.abstract, "The authoritative abstract returned by Semantic Scholar.");
  assert.equal(refreshPaper.semanticScholarPaperId, "refresh-semantic-id");

  const incompletePrimaryPlugin = createPlugin();
  incompletePrimaryPlugin.lookupDefaultPaperMetadata = async () => ({
    source: "Crossref",
    title: "Default-first record",
    authors: ["Ada Lovelace"],
    year: 2025,
    venue: "OSDI",
    abstract: "",
    tags: ["Systems"],
    doi: "10.1234/default-first",
    arxiv: "",
    publicationType: "conference-paper"
  });
  incompletePrimaryPlugin.resolveSemanticScholarPaper = async () => ({
    paperId: "semantic-supplement",
    title: "Semantic title must not replace the default title",
    authors: [{ name: "Ada Lovelace" }],
    year: 2024,
    venue: "arXiv.org",
    abstract: "Semantic Scholar supplies the missing abstract while the default title, year, venue, and DOI remain authoritative. This sentence makes it complete.",
    fieldsOfStudy: ["Computer Science"],
    publicationTypes: ["Preprint"],
    externalIds: { ArXiv: "2501.00001" }
  });
  const supplemented = await incompletePrimaryPlugin.lookupPaperMetadata({
    title: "Default-first record", authors: [], year: 0, venue: "", abstract: "", tags: [], doi: "", arxiv: ""
  });
  assert.equal(supplemented.title, "Default-first record");
  assert.equal(supplemented.venue, "OSDI");
  assert.equal(supplemented.year, 2025);
  assert.equal(supplemented.doi, "10.1234/default-first");
  assert.match(supplemented.abstract, /Semantic Scholar supplies/);
  assert.equal(supplemented.paperId, "semantic-supplement");
  assert.equal(supplemented.source, "Crossref + Semantic Scholar");

  process.stdout.write("Semantic Scholar tests passed\n");
}

run().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
