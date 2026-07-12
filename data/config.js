// Knockoff: runtime config — the DOM selectors the content script uses to find
// search tiles, titles and brand bylines, plus a couple of parsing tunables.
//
// Why this is a data file and not just constants in content.js: Amazon reshuffles
// its search markup often (a layout change is what turns a real brand like Sony
// into "No brand"). Carrying the selectors here lets a fix ship as a *config
// push* from api.knockoff.co on the daily refresh — no extension release,
// no store review, no waiting for every install to update.
//
// This bundled copy is the always-available default AND the fail-safe. A remote
// config only ever *replaces* it wholesale after passing validation
// (mergeConfig in content.js): every selector is syntax-checked and every list
// is bounded, so a malformed or hostile push falls back to these defaults and
// can never break the page.
//
// SELECTORS AND NUMBERS ONLY — never executable code. The remote payload is data
// the shipped querySelectorAll / length checks consume; regexes and the scoring
// logic stay in code, so there is nothing to eval and nothing a store reviewer
// could read as remotely-hosted code.
var KO_DEFAULT_CONFIG = {
  selectors: {
    // Product tiles across Amazon layouts. data-asin anchoring has survived
    // every redesign since ~2019; joined into one selector at scan time.
    tiles: [
      'div[data-component-type="s-search-result"]', // search results
      'div.octopus-pc-item[data-asin]',             // category "octopus" pages
      'li[class*="ProductGridItem"][data-asin]',    // some browse grids
      // p13n "faceout" recommendation grids: "Keep shopping for" mission pages,
      // homepage rows, "Related to items you've viewed".
      'div.p13n-intuition-product-faceout__top-container[data-asin]'
    ],
    // The product title line, tried in order. The title is the <h2> inside the
    // product link (a-text-normal); brand-byline layouts add a second, smaller
    // <h2> for the brand ahead of it, so a plain "first h2" would grab the brand.
    title: [
      "h2.a-text-normal",
      "a.a-link-normal h2",
      "h2"
    ],
    // p13n faceout tiles carry no h2: the title is a non-bold base-plus span.
    titleFallback: [
      "a.a-text-normal",
      ".a-size-base-plus:not(.a-text-bold)"
    ],
    // The brand byline in its own row above the title (authoritative when
    // present — Amazon has been stripping the brand out of the title itself).
    // Current layout renders it as an <h2> in a title-recipe row outside the
    // title's <a> (a direct child), so "> .a-row h2" reaches only the brand row;
    // the older base-plus-span selectors follow as fallbacks. Joined at read time.
    brandRow: [
      '[data-cy="title-recipe"] > .a-row h2',
      '[data-cy="title-recipe"] .a-size-base-plus.a-color-base:not(a *)',
      'h2 + .a-row .a-size-base-plus'
    ],
    // Format-swatch link on book/music/movie tiles (Paperback, Kindle, Blu-ray…).
    // Its presence marks a media work to sit out; the class pair is stable
    // across marketplaces where physical-goods tiles never render it.
    mediaWork: "a.s-link-style.a-text-bold"
  },
  limits: {
    // A "brand row" longer than this is really the title bleeding through a
    // stale selector, not a brand — reject it rather than read a sentence as a
    // brand name. (Brand names are short; titles are long.)
    brandRowMaxLen: 30
  }
};
