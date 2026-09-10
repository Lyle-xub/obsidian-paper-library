const assert = require("node:assert/strict");
const Module = require("node:module");

const obsidianMock = {
  ItemView: class {}, Menu: class {}, Modal: class {}, Notice: class {},
  Plugin: class {}, PluginSettingTab: class {}, Setting: class {},
  loadPdfJs: async () => null, normalizePath: (value) => value,
  requestUrl: async () => ({ json: {} }), setIcon: () => {}
};
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "obsidian") return obsidianMock;
  return originalLoad.call(this, request, parent, isMain);
};
const PaperLibraryPlugin = require("../main.js");
Module._load = originalLoad;

const plugin = Object.create(PaperLibraryPlugin.prototype);
plugin.settings = { tags: [], conferenceRankingDatabase: { conferences: [] } };

const makePaper = (overrides = {}) => ({
  title: "Untitled paper", authors: [], year: 0, venue: "", abstract: "", tags: [],
  collections: [], doi: "", arxiv: "", ...overrides
});

const thesis = makePaper();
plugin.applyBatchImportMetadata(thesis, {
  title: "A doctoral thesis on research tooling",
  itemType: "thesis"
}, "Zotero");
assert.equal(thesis.publicationType, "thesis");

const review = makePaper();
plugin.applyBatchImportMetadata(review, {
  title: "A Systematic Review and Meta-analysis of Paper Managers",
  itemType: "journalArticle",
  venue: "Journal of Research Tools"
}, "Zotero");
assert.equal(review.publicationType, "journal-article");
assert.equal(review.contentType, "systematic-review");

const manual = makePaper({ publicationType: "thesis" });
plugin.applyBatchImportMetadata(manual, { title: "A published version", itemType: "journalArticle" }, "Crossref");
assert.equal(manual.publicationType, "thesis", "manual type corrections must not be overwritten");

const importing = makePaper({ publicationType: "journal-article", importStatus: "online" });
plugin.applyBatchImportMetadata(importing, { title: "Proceedings paper", itemType: "conferencePaper" }, "Zotero");
assert.equal(importing.publicationType, "conference-paper", "active imports should accept a more specific incoming type");

const conference = makePaper({
  title: "Typed Libraries", authors: ["Ada Lovelace"], year: 2026,
  venue: "International Conference on Research Tools",
  publicationType: "conference-paper", contentType: "research-article"
});
assert.match(plugin.buildBibTeX(conference), /^@inproceedings\{/);
assert.match(plugin.buildBibTeX(conference), /content-type:research-article/);
assert.match(plugin.buildRis(conference), /^TY  - CPAPER/m);
assert.match(plugin.buildRis(conference), /^M3  - research-article/m);
assert.match(plugin.buildCsv(conference), /Publication Type,Content Type/);
assert.equal(plugin.getPaperExportRecord(conference).publicationType, "conference-paper");

(async () => {
  const frontmatter = {};
  plugin.app = {
    vault: { getAbstractFileByPath: () => ({ extension: "md" }) },
    fileManager: { processFrontMatter: async (_file, update) => update(frontmatter) }
  };
  conference.notePath = "Papers/Typed Libraries.md";
  await plugin.syncPaperNoteTags(conference);
  assert.equal(frontmatter.publication_type, "conference-paper");
  assert.equal(frontmatter.content_type, "research-article");
  console.log("Publication and content type tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
