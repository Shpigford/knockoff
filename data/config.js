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
    mediaWork: "a.s-link-style.a-text-bold",
    // The featured offer's seller ID inside a search tile (seller-country
    // feature). Both carry the same "A..." ID: read element.value first, then
    // the data-csa-c-merchant-id attribute.
    merchantId: [
      'input[name="merchantId"]',
      "[data-csa-c-merchant-id]"
    ],
    // Seller profile page (/sp?seller=...): every row of the detail section
    // (labels + address lines), and the address lines alone. EU pages carry
    // several address blocks (business + customer services); rows matching
    // sellerAddressRow group into blocks under their preceding label row,
    // and each block's last line is an ISO country code.
    sellerInfoRow: [
      "#page-section-detail-seller-info .a-row"
    ],
    sellerAddressRow: [
      "#page-section-detail-seller-info .a-row.indent-left"
    ],
    // The storefront display name on that same page, reported alongside the
    // country so the backfill queue shows who a seller ID is.
    sellerName: [
      "#seller-name"
    ],
    // Where the seller-country chip anchors inside a tile: the product image,
    // like Amazon's own "Overall Pick" badge — tile text (More Buying Choices,
    // delivery lines) crowds every other corner. Falls back to the tile root.
    merchantChipAnchor: [
      '[data-cy="image-container"]',
      ".s-product-image-container"
    ]
  },
  limits: {
    // A "brand row" longer than this is really the title bleeding through a
    // stale selector, not a brand — reject it rather than read a sentence as a
    // brand name. (Brand names are short; titles are long.)
    brandRowMaxLen: 30
  },
  // "Business Address" label substrings (lowercased), per marketplace UI
  // language. Only consulted when a seller page shows address blocks in
  // DIFFERENT countries (EU pages add a customer-services address): the
  // business block wins, and if no label matches, nothing is reported.
  sellerBizLabels: [
    "business address",     // en
    "geschäftsadresse",     // de
    "adresse commerciale",  // fr
    "indirizzo aziendale",  // it
    "dirección comercial",  // es
    "endereço comercial",   // pt-BR
    "bedrijfsadres",        // nl
    "företagsadress",       // sv
    "adres firmy"           // pl
  ],
  // Amazon retail's own seller IDs, one per marketplace — the featured seller
  // on a large share of tiles, so they're skipped everywhere client-side
  // (no chip, no lookup, no sighting). US and DE verified live; the rest are
  // the well-documented values, correctable by config push.
  amazonSellerIds: [
    "ATVPDKIKX0DER",  // amazon.com
    "A3JWKAKR8XB7XF", // amazon.de
    "A3P5ROKL5A1OLE", // amazon.co.uk
    "A1X6FK5RDHNB96", // amazon.fr
    "APJ6JRA9NG5V4",  // amazon.it
    "A1AT7YVPFBWXBL", // amazon.es
    "A17D2BRD4YMT0X", // amazon.nl
    "ANU9KP01APNAG",  // amazon.se
    "A3DWYIK6Y9EEQB", // amazon.ca
    "AVDBXBAVVSXLQ",  // amazon.com.mx
    "A1ZZFT5FULY4LN", // amazon.com.br
    "AN1VRQENFRJN5",  // amazon.co.jp
    "ANEGB3WVEVKZB",  // amazon.com.au
    "A19VAU5U5O7RUS"  // amazon.sg
  ]
};
