#!/usr/bin/env node
// Knockoff detector test runner. No dependencies:
//   node tests/run.js
// Loads the data files and detector into a sandbox (they're plain classic
// scripts, not modules) and checks every fixture title's verdict, plus the
// locale-agnostic product-page brand extraction.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const ctx = vm.createContext({ URL });
[
  "data/community-brands.js",
  "data/known-brands.js",
  "data/chinese-major.js",
  "data/flagged-brands.js",
  "data/generic-words.js",
  "src/detector.js",
  "src/pdp-brand.js"
].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
});

const Knockoff = ctx.Knockoff;
Knockoff.buildIndexes();

let pass = 0;
let fail = 0;

function check(name, actual, expected, detail) {
  if (actual === expected) {
    pass++;
  } else {
    fail++;
    console.log(`✗ ${name}`);
    console.log(`    expected ${expected}, got ${actual}` + (detail ? ` (${detail})` : ""));
  }
}

const fixtures = require("./fixtures.js");
const settings = { level: "standard", flagChineseMajor: false };
const none = new Set();

for (const [title, expected] of fixtures) {
  const r = Knockoff.classify(title, settings, none, none);
  check(JSON.stringify(title), r.verdict, expected,
    r.brand ? `brand "${r.brand}", ${r.reason}` : r.reason);
}

// Media-category aliases: creator-titled/digital departments the content
// script skips entirely (book/album/movie titles aren't brand-led).
const mediaAliases = [
  "stripbooks", "stripbooks-intl-ship", "english-books", "digital-text",
  "audible", "popular", "digital-music", "movies-tv", "dvd", "instant-video",
  "magazines", "mobile-apps", "software", "gift-cards"
];
const productAliases = ["aps", "videogames", "tools", "electronics", ""];
for (const alias of mediaAliases) {
  check(`media alias "${alias}"`, Knockoff.isMediaAlias(alias), true);
}
for (const alias of productAliases) {
  check(`product alias "${alias}"`, Knockoff.isMediaAlias(alias), false);
}

// Product-detail-page byline extraction: a fake byline node with the localized
// text Amazon shows and the href it links to (the href carries the brand).
function byline(text, href) {
  return {
    textContent: text,
    getAttribute(name) { return name === "href" ? href : null; }
  };
}

const pdpFixtures = [
  ["amazon.de store href", "Besuche den CACOE-Store", "https://www.amazon.de/stores/CACOE/page/4A724295-C84C-46AA-9D3C-7A37363D6D86", "CACOE"],
  ["amazon.com.mx store href", "Visita la tienda de elago", "https://www.amazon.com.mx/stores/elago/page/FFBF2781-B9BD-4273-AF09-9695833C1749", "elago"],
  ["amazon.com.br brand param", "Marca: Genérico", "https://www.amazon.com.br/s/ref=bl_dp_s_web_16209062011?ie=UTF8&field-brandtextbin=Gen%C3%A9rico", "Genérico"],
  ["amazon.sg brand param", "Brand: supfine", "/s/ref=bl_dp_s_web_6314449051?ie=UTF8&field-brandtextbin=supfine", "supfine"],
  ["amazon.eg keyword fallback", "Brand: Red2Fire", "/-/en/s/ref=bl_dp_s_web_0?ie=UTF8&field-keywords=Red2Fire", "Red2Fire"],
  ["english text preferred over store slug", "Visit the UGREEN Store", "https://www.amazon.sa/stores/UGREENGROUPLIMITEDKSA/page/x", "UGREEN"],
  ["p_89 filter", "", "https://www.amazon.com/s?rh=n%3A123%2Cp_89%3APB+Swiss+Tools", "PB Swiss Tools"],
  ["legacy brand text", "Brand: DEWALT", "", "DEWALT"]
];

for (const [name, text, href, expected] of pdpFixtures) {
  const actual = ctx.KnockoffPdp.brandFromByline(byline(text, href), "https://www.amazon.com/dp/B0TEST0000");
  check(name, actual, expected);
}

console.log(`\n${pass}/${pass + fail} checks pass`);
process.exit(fail ? 1 : 0);
