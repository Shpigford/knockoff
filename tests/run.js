#!/usr/bin/env node
// Knockoff detector test runner. No dependencies:
//   node tests/run.js
// Loads the data files and detector into a sandbox (they're plain classic
// scripts, not modules) and checks every fixture title's verdict.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const ctx = vm.createContext({});
[
  "data/abf-brands.js",
  "data/known-brands.js",
  "data/chinese-major.js",
  "data/flagged-brands.js",
  "data/generic-words.js",
  "src/detector.js"
].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
});

const Knockoff = ctx.Knockoff;
Knockoff.buildIndexes();

const fixtures = require("./fixtures.js");
const settings = { level: "standard", flagChineseMajor: false };
const none = new Set();

let pass = 0;
let fail = 0;

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const matches = manifest.content_scripts.flatMap((script) => script.matches || []);
const supportedDomains = [
  "amazon.ae",
  "amazon.ca",
  "amazon.cn",
  "amazon.co.jp",
  "amazon.co.uk",
  "amazon.co.za",
  "amazon.com",
  "amazon.com.au",
  "amazon.com.be",
  "amazon.com.br",
  "amazon.com.mx",
  "amazon.com.tr",
  "amazon.de",
  "amazon.eg",
  "amazon.es",
  "amazon.fr",
  "amazon.ie",
  "amazon.in",
  "amazon.it",
  "amazon.nl",
  "amazon.pl",
  "amazon.sa",
  "amazon.se",
  "amazon.sg"
];
for (const domain of supportedDomains) {
  const match = `https://www.${domain}/*`;
  if (matches.includes(match)) {
    pass++;
  } else {
    fail++;
    console.log(`✗ manifest content script should run on ${match}`);
  }
}

for (const [title, expected] of fixtures) {
  const r = Knockoff.classify(title, settings, none, none);
  if (r.verdict === expected) {
    pass++;
  } else {
    fail++;
    console.log(`✗ ${JSON.stringify(title)}`);
    console.log(`    expected ${expected}, got ${r.verdict}` +
      (r.brand ? ` (brand "${r.brand}", ${r.reason})` : ` (${r.reason})`));
  }
}

console.log(`\n${pass}/${pass + fail} checks pass`);
process.exit(fail ? 1 : 0);
