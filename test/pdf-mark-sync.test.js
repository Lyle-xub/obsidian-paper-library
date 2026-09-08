const assert = require("node:assert/strict");
const Module = require("node:module");

const obsidianMock = {
  ItemView: class {}, Menu: class {}, Modal: class {}, Notice: class {},
  Plugin: class {}, PluginSettingTab: class {}, Setting: class {},
  loadPdfJs: async () => ({}),
  normalizePath: (path) => String(path).replace(/\\/g, "/").replace(/^\.\//, ""),
  requestUrl: async () => ({}), setIcon: () => {}
};
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "obsidian") return obsidianMock;
  return originalLoad.call(this, request, parent, isMain);
};
const PaperLibraryPlugin = require("../main.js");
Module._load = originalLoad;

async function run() {
  const plugin = Object.create(PaperLibraryPlugin.prototype);
  const paper = {
    id: "paper-moved",
    title: "Moved paper",
    pdfPath: "Papers/New/moved.pdf",
    annotations: [{
      id: "annotation-1",
      pdfPath: "Papers/Old/moved.pdf",
      link: "Papers/Old/moved.pdf#page=2"
    }],
    researchWorkspace: {
      highlights: [], nodes: [], links: [],
      inkStrokes: [{ id: "ink-1", page: 2, pdfPath: "Papers/Old/moved.pdf", points: [{ x: 0.2, y: 0.3 }] }]
    }
  };
  plugin.settings = { papers: [paper] };
  plugin.app = {
    vault: { getAbstractFileByPath: (path) => path === paper.pdfPath ? { path } : null },
    workspace: { getLeavesOfType: () => [] }
  };
  plugin.saveSettings = async () => {};
  plugin.refreshViews = () => {};

  assert.equal(plugin.repairOrphanedPaperPdfMarkPaths(paper), 2);
  assert.equal(paper.annotations[0].pdfPath, paper.pdfPath);
  assert.equal(paper.annotations[0].link, `${paper.pdfPath}#page=2`);
  assert.equal(plugin.getPdfInkStrokes(paper, paper.pdfPath, 2).length, 1);

  const renamedFrom = paper.pdfPath;
  await plugin.handleManagedPdfRename({ path: "Papers/Renamed/moved.pdf", extension: "pdf" }, renamedFrom);
  assert.equal(paper.pdfPath, "Papers/Renamed/moved.pdf");
  assert.equal(paper.annotations[0].pdfPath, paper.pdfPath);
  assert.equal(paper.researchWorkspace.inkStrokes[0].pdfPath, paper.pdfPath);
}

run().then(() => console.log("pdf mark sync tests passed")).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
