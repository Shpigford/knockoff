#!/usr/bin/env node
// Bundle the extension into a single userscript for Userscripts for Safari
// (also works in Tampermonkey/Violentmonkey). The extension sources are
// included verbatim; userscript/runtime.js supplies the chrome.* shim, the
// launcher button, and the in-page settings sheet. See that file's header
// for what differs from the real extension.
//
//   node scripts/build-userscript.js [outfile]   (default: dist/knockoff.user.js)

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

const manifest = JSON.parse(read("manifest.json"));
const out = process.argv[2] || path.join(root, "dist", "knockoff.user.js");

const matches = manifest.content_scripts[0].matches
  .map((m) => "// @match        " + m)
  .join("\n");

const header = `// ==UserScript==
// @name         ${manifest.name}
// @namespace    https://github.com/Shpigford/knockoff
// @version      ${manifest.version}
// @description  ${manifest.description} Userscript build; the browser extension is preferred where available.
// @author       Josh Pigford & contributors
// @homepageURL  https://knockoff.shopping
// @supportURL   https://github.com/Shpigford/knockoff/issues
${matches}
// @run-at       document-end
// @noframes
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM.listValues
// ==/UserScript==
`;

const runtime = read("userscript/runtime.js")
  .replace("__KO_VERSION__", () => manifest.version)
  .replace("__KO_CSS__", () => JSON.stringify(read("src/styles.css")));

// Same files, same order as the manifest's content_scripts (minus the
// background worker, whose only job — the toolbar button — the launcher does).
const body = manifest.content_scripts[0].js
  .map((f) => `\n// ── ${f} ` + "─".repeat(Math.max(2, 74 - f.length)) + "\n\n" + read(f))
  .join("");

// One enclosing IIFE so `var chrome`, the KO_* data arrays, and Knockoff
// itself never leak onto Amazon's window (Amazon scripts sniff window.chrome).
const bundle = header + "\n(function () {\n\n" + runtime + body + "\n})();\n";

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, bundle);
console.log(`Built ${path.relative(root, out)} (${(bundle.length / 1024).toFixed(0)} KB, v${manifest.version})`);
