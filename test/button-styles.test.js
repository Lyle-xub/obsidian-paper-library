const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const styles = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
const primaryRule = styles.match(/\.paperlib-editor-actions > button\.mod-cta,[\s\S]*?\n\}/)?.[0] || "";

assert.match(primaryRule, /\.paperlib-modal-buttons > button\.mod-cta/);
assert.match(primaryRule, /background:[\s\S]*linear-gradient[\s\S]*!important/);
assert.match(primaryRule, /color: #fff !important/);

console.log("Paper Library primary button style tests passed.");
