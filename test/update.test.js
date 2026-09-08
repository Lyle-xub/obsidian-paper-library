const assert = require("node:assert/strict");
const Module = require("node:module");

const obsidianMock = {
  ItemView: class {}, Menu: class {}, Modal: class {}, Notice: class {},
  Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, Platform: {},
  addIcon: () => {}, requireApiVersion: () => true,
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

const {
  normalizePaperLibraryReleaseVersion,
  comparePaperLibraryVersions,
  selectPaperLibraryReleaseAsset,
  isSafePaperLibraryZipEntry,
  isPaperLibraryReleaseFile
} = PaperLibraryPlugin.updateInternals;

assert.equal(normalizePaperLibraryReleaseVersion("v0.42.0"), "0.42.0");
assert.equal(comparePaperLibraryVersions("0.42.0", "0.41.9"), 1);
assert.equal(comparePaperLibraryVersions("0.42.0-beta.1", "0.42.0"), -1);
assert.equal(selectPaperLibraryReleaseAsset({ assets: [
  { name: "paper-library-web-importer-2.1.0.zip" },
  { name: "paper-library-0.42.0.zip", browser_download_url: "complete" }
] }, "0.42.0").browser_download_url, "complete");
assert.equal(isSafePaperLibraryZipEntry("paper-library/vendor/runtime.js"), true);
assert.equal(isSafePaperLibraryZipEntry("paper-library/../../data.json"), false);
assert.equal(isSafePaperLibraryZipEntry("/tmp/main.js"), false);
assert.equal(isPaperLibraryReleaseFile("vendor/claudian.bundle.js"), true);
assert.equal(isPaperLibraryReleaseFile("pipeline/worker.cjs"), true);
assert.equal(isPaperLibraryReleaseFile("data.json"), false);
assert.equal(isPaperLibraryReleaseFile("models/model.onnx"), false);

console.log("Self-update tests passed.");
