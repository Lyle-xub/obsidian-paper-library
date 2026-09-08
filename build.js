const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const files = [
  "main.js",
  "manifest.json",
  "styles.css",
  "versions.json",
  "doclayout_extract.py",
  "DOCLAYOUT_NOTICE.md",
  "LICENSE",
  "vendor",
  "pipeline"
];
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "paper-library-release-"));
const packageRoot = path.join(temporaryRoot, "paper-library");
const outputDirectory = path.join(root, "dist");
const output = path.join(outputDirectory, `paper-library-${manifest.version}.zip`);

try {
  fs.mkdirSync(packageRoot, { recursive: true });
  for (const relativePath of files) {
    const source = path.join(root, relativePath);
    if (!fs.existsSync(source)) throw new Error(`Missing release file: ${relativePath}`);
    fs.cpSync(source, path.join(packageRoot, relativePath), { recursive: true });
  }
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.rmSync(output, { force: true });
  if (process.platform === "win32") {
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Compress-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force",
      packageRoot,
      output
    ], { stdio: "inherit" });
  } else {
    execFileSync("zip", ["-qry", output, "paper-library"], { cwd: temporaryRoot, stdio: "inherit" });
  }
  console.log(output);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
