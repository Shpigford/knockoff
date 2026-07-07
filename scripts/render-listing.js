#!/usr/bin/env node
// Render + validate Knockoff's store listing from the single source of truth,
// store-assets/listing.json. Checks every field against its store's character
// limit, checks manifest.json's description hasn't drifted from shared.summary,
// then prints copy-paste-ready blocks for each store. Exits non-zero on any
// problem, so it can gate a release (drop it into CI or the release script).
//
//   node scripts/render-listing.js            print paste blocks + validate
//   node scripts/render-listing.js --check    validate only (for CI gating)
//
// Chrome listing text is dashboard-only — paste the printed blocks. Firefox and
// Safari can be pushed via their APIs (AMO / App Store Connect, the latter via
// scripts/submit-appstore.rb).

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const L = JSON.parse(fs.readFileSync(path.join(root, "store-assets/listing.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

const checkOnly = process.argv.indexOf("--check") !== -1;
const problems = [];

// ── Validation ───────────────────────────────────────────────────────────────

function checkLen(label, value, max) {
  var n = (value || "").length;
  var ok = n <= max;
  console.log("  " + (ok ? "ok  " : "OVER") + "  " + label.padEnd(24) + n + " / " + max);
  if (!ok) problems.push(label + " is " + n + " chars, over the " + max + " limit");
}

console.log("Character limits");
checkLen("chrome.summary", L.shared.summary, L.chrome.summaryCharLimit);
checkLen("chrome.description", L.shared.description, L.chrome.descriptionCharLimit);
checkLen("firefox.summary", L.firefox.summary, L.firefox.summaryCharLimit);
checkLen("safari.subtitle", L.safari.subtitle, L.safari.subtitleCharLimit);
checkLen("safari.keywords", L.safari.keywords, L.safari.keywordsCharLimit);
checkLen("safari.promotionalText", L.safari.promotionalText, L.safari.promotionalTextCharLimit);

// The manifest's short description is a fourth surface the summary can drift on;
// keep it identical to shared.summary. (Chrome caps manifest description at 132,
// same as the CWS summary, so the length check above covers it too.)
console.log("\nDrift check");
if (manifest.description === L.shared.summary) {
  console.log("  ok    manifest.description matches shared.summary");
} else {
  console.log("  DRIFT manifest.description differs from shared.summary");
  console.log("        manifest: " + JSON.stringify(manifest.description));
  console.log("        listing : " + JSON.stringify(L.shared.summary));
  problems.push("manifest.json description has drifted from shared.summary");
}

if (problems.length) {
  console.log("\n" + problems.length + " problem(s):");
  problems.forEach(function (p) { console.log("  - " + p); });
  process.exit(1);
}

if (checkOnly) {
  console.log("\nAll checks passed.");
  process.exit(0);
}

// ── Render paste blocks ──────────────────────────────────────────────────────

function block(title, fields) {
  console.log("\n" + "─".repeat(74));
  console.log(title);
  console.log("─".repeat(74));
  fields.forEach(function (f) {
    console.log("\n[" + f[0] + "]");
    console.log(f[1]);
  });
}

block("CHROME WEB STORE  —  paste into the Store listing tab (dashboard only)", [
  ["Summary", L.shared.summary],
  ["Description", L.shared.description],
  ["Category", L.shared.category]
]);

block("FIREFOX / AMO  —  push via the AMO add-on API", [
  ["Name", L.name],
  ["Summary", L.firefox.summary],
  ["Description", L.shared.description],
  ["Category", L.shared.category]
]);

block("SAFARI / APP STORE  —  push via App Store Connect (scripts/submit-appstore.rb)", [
  ["Subtitle", L.safari.subtitle],
  ["Keywords", L.safari.keywords],
  ["Promotional text", L.safari.promotionalText],
  ["Description", L.shared.description]
]);

// The current "What's new" copy: everything under the Unreleased heading.
var notes = fs.readFileSync(path.join(root, "store-assets/release-notes.md"), "utf8");
var m = notes.match(/## Unreleased\s*\n([\s\S]*?)(?=\n## |$)/);
if (m && m[1].trim()) {
  block("RELEASE NOTES — Unreleased  —  paste into each store's \"What's new\"", [
    ["What's new", m[1].trim()]
  ]);
}

console.log("\nAll checks passed.");
