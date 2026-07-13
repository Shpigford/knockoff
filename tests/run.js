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
  "data/config.js",
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

// Allowlist survives a category-first title. Amazon's browse/category listings
// lead with a category noun ("Besteckkorb OLLEIRA …") and expose no dedicated
// brand element on the card, so brand extraction would read the category noun
// and dim the tile — even for a brand the shopper allowlisted. A user-allowed
// brand anywhere in the title is honored regardless of position, while a shopper
// with no allowlist sees extraction unchanged (issue: allowlisted brands stayed
// dimmed on category/browse pages though product pages and search worked).
const allowOlleira = new Set([Knockoff.normalize("OLLEIRA")]);
check("allowlisted brand mid category-first title",
  Knockoff.classify("Besteckkorb OLLEIRA Geschirrspüler Ersatz", settings, allowOlleira, none).verdict, "allowed");
check("allowlisted brand late in title",
  Knockoff.classify("Besteckkorb für Geschirrspüler Universal OLLEIRA Ersatz", settings, allowOlleira, none).verdict, "allowed");
check("no allowlist leaves category-first extraction unchanged",
  Knockoff.classify("Besteckkorb OLLEIRA Geschirrspüler Ersatz", settings, none, none).brand, "Besteckkorb");
// A trusted brand mid-title is only honored when the leading brand isn't itself
// junk or blocked: junk that name-drops a trusted brand for compatibility
// ("SZHLUX … für Bosch", shopper trusts Bosch) keeps its verdict, and an
// explicit blocklist on the leading brand still wins. Otherwise allowlisting a
// popular brand would un-hide every knockoff that lists it as compatible.
const allowBosch = new Set([Knockoff.normalize("Bosch")]);
check("allowlisted compat mention doesn't rescue flagged junk",
  Knockoff.classify("SZHLUX Besteckkorb für Bosch Siemens Geschirrspüler", settings, allowBosch, none).verdict, "flagged");
check("allowlist doesn't override a blocked leading brand",
  Knockoff.classify("SZHLUX Besteckkorb für Bosch Siemens Geschirrspüler", settings, allowBosch, new Set([Knockoff.normalize("SZHLUX")])).verdict, "blocked");
check("allowlisted ecosystem name doesn't rescue compat-bait",
  Knockoff.classify("TEKPREM Case Compatible with Samsung Galaxy S24", settings, new Set([Knockoff.normalize("Samsung")]), none).verdict, "flagged");
// The legit counterpart still works: an innocuous leading category noun means a
// real trusted brand mid-title is plausibly the product's own → spare it.
check("trusted brand mid-title with innocuous lead is spared",
  Knockoff.classify("Dishwasher Cutlery Basket for Bosch Constructa Replacement", settings, allowBosch, none).verdict, "allowed");

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

// ── Data-file integrity ─────────────────────────────────────────────────────
// Catches the bulk-edit mistakes classify() can't see: a normalized-key
// collision (an exact dup, or a punctuation/case variant of an entry already
// present — "Black+Decker" ≡ "Black & Decker"), a blank/whitespace-dirty entry,
// or a name listed as both junk (flagged) and a real brand. The generated
// community snapshot is exempt from the dup scan (its collisions come from
// upstream and dedupe at runtime) but still counts as a real-brand list below.
function keyOf(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ""); }

const handLists = {
  "known-brands": ctx.KO_KNOWN_BRANDS,
  "chinese-major": ctx.KO_CHINESE_MAJOR,
  "flagged-brands": ctx.KO_FLAGGED_BRANDS,
  "generic-words": ctx.KO_GENERIC_WORDS
};
for (const name of Object.keys(handLists)) {
  const seen = Object.create(null);
  let dup = "none", dirty = "none";
  for (const e of handLists[name]) {
    if (typeof e !== "string" || e === "" || e !== e.trim()) {
      if (dirty === "none") dirty = JSON.stringify(e);
      continue;
    }
    const k = keyOf(e);
    if (seen[k]) { if (dup === "none") dup = `${JSON.stringify(e)} ≡ ${JSON.stringify(seen[k])}`; }
    else seen[k] = e;
  }
  check(`${name}: unique keys`, dup, "none");
  check(`${name}: clean entries`, dirty, "none");
}

// A name can't be both a real brand and flagged junk.
const realKey = Object.create(null);
for (const [src, arr] of [["known", ctx.KO_KNOWN_BRANDS], ["chinese", ctx.KO_CHINESE_MAJOR], ["community", ctx.KO_COMMUNITY_BRANDS]]) {
  for (const e of arr || []) { const k = keyOf(e); if (!realKey[k]) realKey[k] = src; }
}
let conflict = "none";
for (const e of ctx.KO_FLAGGED_BRANDS) {
  if (realKey[keyOf(e)] && conflict === "none") conflict = `${JSON.stringify(e)} (flagged + ${realKey[keyOf(e)]})`;
}
check("flagged-brands: no real-brand contradiction", conflict, "none");

// ── Bundled config shape ─────────────────────────────────────────────────────
// data/config.js is the fail-safe the content script falls back to when there's
// no (valid) remote config, so a fat-finger here — a mistyped key, a non-array
// selector list — would strip the default with no runtime error. Assert the
// shape content.js/mergeConfig reads. (Selector *syntax* is checked at runtime
// against a live DOM, which the Node sandbox doesn't have.)
const cfg = ctx.KO_DEFAULT_CONFIG;
const sel = (cfg && cfg.selectors) || {};
for (const key of ["tiles", "title", "titleFallback", "brandRow", "merchantId", "sellerInfoRow", "sellerAddressRow", "sellerName", "merchantChipAnchor"]) {
  check(`config.selectors.${key}: non-empty string array`,
    Array.isArray(sel[key]) && sel[key].length > 0 &&
      sel[key].every((s) => typeof s === "string" && !!s.trim()), true);
}
check("config.selectors.mediaWork: non-empty string",
  typeof sel.mediaWork === "string" && !!sel.mediaWork.trim(), true);
check("config.limits.brandRowMaxLen: positive number",
  typeof (cfg.limits || {}).brandRowMaxLen === "number" && cfg.limits.brandRowMaxLen > 0, true);
check("config.sellerBizLabels: non-empty lowercase string array",
  Array.isArray(cfg.sellerBizLabels) && cfg.sellerBizLabels.length > 0 &&
    cfg.sellerBizLabels.every((s) => typeof s === "string" && s === s.toLowerCase()), true);
check("config.amazonSellerIds: valid merchant ids incl. US + DE retail",
  Array.isArray(cfg.amazonSellerIds) &&
    cfg.amazonSellerIds.every((id) => Knockoff.isMerchantId(id)) &&
    cfg.amazonSellerIds.includes("ATVPDKIKX0DER") &&
    cfg.amazonSellerIds.includes("A3JWKAKR8XB7XF"), true);
// The brand-byline fix must stay in the bundled default (the brand <h2> in its
// own title-recipe row above the title), so a fresh install reads it before any
// remote config lands — otherwise Sony et al. read as "No brand" again.
check("config.brandRow keeps the title-recipe brand-row selector",
  sel.brandRow.indexOf('[data-cy="title-recipe"] > .a-row h2') !== -1, true);

// ── Seller country helpers ──────────────────────────────────────────────────
// Pure pieces of the opt-in seller-country feature (content.js does the DOM
// and network work). Parsing must fail closed: anything that isn't a bare ISO
// alpha-2 line means "report nothing".
check("merchant id: real 14-char", Knockoff.isMerchantId("A19M56O6GSQ8VV"), true);
check("merchant id: real 13-char", Knockoff.isMerchantId("AQJ95ZUWOKZ5J"), true);
check("merchant id: amazon retail", Knockoff.isMerchantId("ATVPDKIKX0DER"), true);
check("merchant id: too short", Knockoff.isMerchantId("A12345"), false);
check("merchant id: lowercase", Knockoff.isMerchantId("a19m56o6gsq8vv"), false);
check("merchant id: no A prefix", Knockoff.isMerchantId("B19M56O6GSQ8VV"), false);
check("merchant id: non-string", Knockoff.isMerchantId(null), false);
check("address → country: CN last line",
  Knockoff.countryFromAddressLines(["坂田街道大发埔社区里浦路3号", "深圳市 龙岗区", "518129", "CN"]), "CN");
check("address → country: trailing blank line",
  Knockoff.countryFromAddressLines(["1 Main St", "Springfield", "US", "  "]), "US");
check("address → country: localized name is no match",
  Knockoff.countryFromAddressLines(["1 Main St", "United States"]), null);
check("address → country: postcode last is no match",
  Knockoff.countryFromAddressLines(["1 Main St", "98109"]), null);
check("address → country: empty", Knockoff.countryFromAddressLines([]), null);
check("address → country: non-array", Knockoff.countryFromAddressLines(null), null);
check("flag emoji CN", Knockoff.flagEmoji("CN"), "\u{1F1E8}\u{1F1F3}");
check("flag emoji US", Knockoff.flagEmoji("US"), "\u{1F1FA}\u{1F1F8}");
check("flag emoji garbage", Knockoff.flagEmoji("Z"), "");

// Multi-block seller pages (EU): business address vs customer-services
// address, grouped by label rows. Verbatim shape of a real amazon.de page —
// a GB mail-forwarder listed as customer services, HK as the business.
const BIZ_LABELS = ctx.KO_DEFAULT_CONFIG.sellerBizLabels;
function sellerRows(pairs) {
  return pairs.map(([text, indent]) => ({ text, indent }));
}
check("seller rows: single US block",
  Knockoff.countryFromSellerRows(sellerRows([
    ["Business Name: x", false], ["Business Address:", false],
    ["123 Road", true], ["Shenzhen", true], ["518129", true], ["CN", true]
  ]), BIZ_LABELS), "CN");
check("seller rows: two blocks agreeing needs no label",
  Knockoff.countryFromSellerRows(sellerRows([
    ["Whatever-Adresse:", false], ["1 Str", true], ["DE", true],
    ["Andere Adresse:", false], ["2 Str", true], ["DE", true]
  ]), BIZ_LABELS), "DE");
check("seller rows: disagreeing blocks — business label wins",
  Knockoff.countryFromSellerRows(sellerRows([
    ["Customer Services Address:", false],
    ["14 Manor Rise", true], ["WAKEFIELD", true], ["WF2 6PE", true], ["GB", true],
    ["Business Address:", false],
    ["NO.48 KWONG WA STREET", true], ["KL", true], ["999077", true], ["HK", true]
  ]), BIZ_LABELS), "HK");
check("seller rows: disagreeing blocks, localized business label",
  Knockoff.countryFromSellerRows(sellerRows([
    ["Adresse für Kundenservice:", false], ["1 Weg", true], ["GB", true],
    ["Geschäftsadresse:", false], ["2 Weg", true], ["CN", true]
  ]), BIZ_LABELS), "CN");
check("seller rows: mixed-case remote-config labels still match",
  Knockoff.countryFromSellerRows(sellerRows([
    ["Customer Services Address:", false], ["1 Way", true], ["GB", true],
    ["Business Address:", false], ["2 Way", true], ["HK", true]
  ]), ["Business Address"]), "HK");
check("seller rows: disagreeing blocks, unrecognized labels — report nothing",
  Knockoff.countryFromSellerRows(sellerRows([
    ["\u4f4f\u6240:", false], ["1", true], ["GB", true],
    ["\u6240\u5728\u5730:", false], ["2", true], ["HK", true]
  ]), BIZ_LABELS), null);
check("seller rows: no country anywhere",
  Knockoff.countryFromSellerRows(sellerRows([
    ["Business Address:", false], ["1 Main St", true], ["United States", true]
  ]), BIZ_LABELS), null);
check("seller rows: non-array", Knockoff.countryFromSellerRows(null, BIZ_LABELS), null);

console.log(`\n${pass}/${pass + fail} checks pass`);
process.exit(fail ? 1 : 0);
