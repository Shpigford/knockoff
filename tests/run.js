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

// Authoritative-brand classification: a brand string Amazon hands us in a
// dedicated element — a search tile's brand byline (rendered above the title on
// newer layouts) or a product-page byline. The whole string is the brand, so
// it's never "unbranded" and the title-leading-word guards don't apply: a real
// brand opening with an ordinary word reads correctly, while junk names still
// score. This is what saves listings whose brand Amazon has stripped from the
// title (issue: "Pet Junkie" byline read as "No brand").
const brandFixtures = [
  ["Pet Junkie", "unknown"],   // real US brand; "Pet" is generic but this isn't the title
  ["Klein Tools", "known"],    // multi-word listed brand
  ["DEWALT", "known"],
  ["Anker", "known"],          // Chinese-major → known by default
  ["HORUSDY", "flagged"],      // seed blocklist
  ["SZHLUX", "flagged"],       // heuristic: consonant run, almost no vowels
  ["ソニー", "foreign"],        // non-Latin byline: unreadable, fail open
  ["", "foreign"]              // empty byline: fail open, no badge
];
for (const [name, expected] of brandFixtures) {
  const r = Knockoff.classifyBrand(name, settings, none, none);
  check(`brand "${name}"`, r.verdict, expected, r.reason);
}

const bylineCompat = Knockoff.classifyBrand(
  "Teeind",
  settings,
  none,
  none,
  "USB Type C Cable Fast Charging, C Charger Cables Compatible with Samsung S10e/note 9/s10/s9/s8 Plus"
);
check("brand byline with compatibility-bait title", bylineCompat.verdict, "suspect", bylineCompat.reason);

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

// Seller-name classification ("Sold by" on product pages). Warn-only surface:
// the content script only badges flagged/blocked, so `unknown` here means
// "stay quiet". Commerce boilerplate (Direct, Official Store, US...) must
// never count as evidence, and a known brand anywhere vetoes.
const sellerFixtures = [
  ["SZHLUX Direct", "flagged"],            // heuristic through the noise word
  ["HORUSDY", "flagged"],                  // seed blocklist
  ["ZDWTZJX Official Store", "flagged"],   // consonant run + all caps
  ["Anker Direct", "known"],               // known-brand token vetoes
  ["Apple", "known"],
  ["The Home Depot", "unknown"],           // boilerplate-only: quiet
  ["Greenfield Trading Co", "unknown"],    // plain English name: quiet
  ["ABC Distributors", "unknown"],         // lone all-caps token (score 3): below the warn bar, quiet
  ["Johnson Smith Company", "known"],      // surname is a listed brand (Smith): veto wins, also quiet
];
for (const [name, expected] of sellerFixtures) {
  const r = ctx.Knockoff.classifySeller(name, none, none);
  check(`seller "${name}"`, r.verdict, expected, r.reason);
}

// ── Rating filter helpers ────────────────────────────────────────────────────
check("parseRating en", Knockoff.parseRating("4.3 out of 5 stars"), 4.3);
check("parseRating comma locale", Knockoff.parseRating("4,3 von 5 Sternen"), 4.3);
check("parseRating whole", Knockoff.parseRating("5 out of 5 stars"), 5);
check("parseRating none", Knockoff.parseRating("No ratings"), null);
check("parseRating empty", Knockoff.parseRating(""), null);
check("parseRating over-5 rejected", Knockoff.parseRating("1234 ratings"), null);
// ja alt text leads with the scale; the score is the decimal-bearing number.
check("parseRating scale-first", Knockoff.parseRating("5つ星のうち4.3"), 4.3);
check("parseReviewCount comma", Knockoff.parseReviewCount("1,234"), 1234);
check("parseReviewCount dot", Knockoff.parseReviewCount("1.234"), 1234);
check("parseReviewCount parens", Knockoff.parseReviewCount("(89)"), 89);
check("parseReviewCount plain", Knockoff.parseReviewCount("12"), 12);
check("parseReviewCount none", Knockoff.parseReviewCount("ratings"), null);
// Abbreviated counts expand numerically; digit-stripping "1.2K" would read 12.
check("parseReviewCount K", Knockoff.parseReviewCount("1.2K"), 1200);
check("parseReviewCount K comma decimal", Knockoff.parseReviewCount("1,2K"), 1200);
check("parseReviewCount K plus", Knockoff.parseReviewCount("3K+"), 3000);
check("parseReviewCount M", Knockoff.parseReviewCount("1.1M"), 1100000);
check("parseReviewCount word after digit", Knockoff.parseReviewCount("1 Kundenrezension"), 1);
// A combined rating+count aria-label must yield the trailing count, not every
// digit concatenated (would be 4,551,234).
check("parseReviewCount combined label", Knockoff.parseReviewCount("4.5 out of 5 stars, 1,234 ratings"), 1234);
check("parseReviewCount combined K label", Knockoff.parseReviewCount("4.5 out of 5 stars, 1.2K ratings"), 1200);

var rOff = { minRating: 0, minReviews: 0, filterUnrated: false };
var r4 = { minRating: 4, minReviews: 0, filterUnrated: false };
var rRev100 = { minRating: 0, minReviews: 100, filterUnrated: false };
var rBoth = { minRating: 4, minReviews: 100, filterUnrated: false };
var r4unrated = { minRating: 4, minReviews: 0, filterUnrated: true };

// Joined to a string so check()'s === comparison works on the arrays.
function failures(rating, reviews, s) {
  return Knockoff.ratingFailures(rating, reviews, s).join(",");
}

check("ratingFailures off", failures(2, 100, rOff), "");
check("ratingFailures below rating", failures(3.5, 1000, r4), "rating");
check("ratingFailures at rating threshold", failures(4, 1000, r4), "");
check("ratingFailures above rating", failures(4.5, 1000, r4), "");
check("ratingFailures unrated off", failures(null, null, r4), "");
check("ratingFailures unrated on", failures(null, null, r4unrated), "unrated");
// Review-count minimum: few reviews fails even with a great rating.
check("ratingFailures too few reviews", failures(4.8, 5, rRev100), "reviews");
check("ratingFailures enough reviews", failures(4.8, 100, rRev100), "");
check("ratingFailures reviews unknown", failures(4.8, null, rRev100), "");
check("ratingFailures both axes", failures(2, 5, rBoth), "rating,reviews");

console.log(`\n${pass}/${pass + fail} checks pass`);
process.exit(fail ? 1 : 0);
