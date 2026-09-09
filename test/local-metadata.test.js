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
plugin.settings = { conferenceRankingDatabase: { conferences: [] } };

const title = "Teaching The Old Dog New Tricks: Building Efficient Data Pipelines for Large-Scale LLM Pre-training (Operational Systems)";
const sample = `${title}
Luofan Chen1,2*† Chenhan Wang1,2*† Weidong Zhang2‡ Jinxin Chi2 Hequan Zhang2 Zanbo Wang2
1University of Science and Technology of China 2ByteDance Seed
Abstract
Data pipelines play a critical role in the performance of large-scale pre-training jobs running on thousands of GPUs. This local abstract must remain available when online metadata has no abstract.
1 Introduction
Body text`;

assert.deepEqual(plugin.extractAuthorsFromPdfText(sample, title), [
  "Luofan Chen", "Chenhan Wang", "Weidong Zhang", "Jinxin Chi", "Hequan Zhang", "Zanbo Wang"
]);
assert.match(plugin.extractAbstractFromPdfText(sample), /^Data pipelines play a critical role/);
assert.ok(!plugin.extractAbstractFromPdfText(sample).includes("Introduction"));
assert.equal(plugin.guessVenueFromPdfText("Proceedings of the 20th USENIX Symposium on Operating Systems Design and Implementation, 2026"), "OSDI");
assert.equal(plugin.guessVenueFromPdfText("Proceedings of the 42nd International Conference on Machine Learning"), "ICML");
assert.equal(plugin.guessVenueFromPdfText("IEEE/CVF Conference on Computer Vision and Pattern Recognition 2026"), "CVPR");
plugin.settings.conferenceRankingDatabase.conferences.push({
  kind: "conference",
  shortName: "Performance",
  fullName: "International Symposium on Computer Performance, Modeling, Measurements",
  dblp: "performance",
  aliases: ["Performance"]
});
plugin.conferenceRankingLookup = null;
assert.equal(plugin.guessVenueFromPdfText("Abstract\nOur method improves GUI agent performance by reducing visual tokens."), "");
assert.equal(plugin.guessVenueFromPdfText("International Symposium on Computer Performance, Modeling, Measurements"), "Performance");
assert.equal(plugin.isAmbiguousConferenceVenue("Performance"), true);
assert.equal(plugin.isAmbiguousConferenceVenue("OSDI"), false);
assert.equal(plugin.guessYearFromPdfMetadata("", "arXiv: 2605.19260", "2605.19260"), 2026);
assert.equal(plugin.guessYearFromPdfMetadata("", "Reference identifier 2605.19260", ""), 0);
assert.equal(plugin.guessYearFromPdfMetadata("", "Published in 2026", ""), 2026);
assert.equal(plugin.mergePaperMetadata(
  { title: "AQuaUI", authors: [], year: 1926, venue: "", abstract: "", tags: [], doi: "", arxiv: "2605.19260" },
  { title: "AQuaUI", authors: [], year: 2026, venue: "arXiv", abstract: "", tags: [], doi: "", arxiv: "2605.19260", publicationType: "preprint" }
).year, 2026);
assert.equal(plugin.mergePaperMetadata(
  { title, authors: [], year: 2026, venue: "", abstract: "Local abstract", tags: [], doi: "", arxiv: "" },
  { title, authors: [], year: 2026, venue: "OSDI", abstract: "", tags: [], doi: "", arxiv: "" }
).abstract, "Local abstract");

console.log("Local PDF metadata tests passed.");
