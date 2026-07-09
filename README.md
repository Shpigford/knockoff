![Knockoff: Amazon, without the knockoffs](store-assets/promo-marquee.png)

# Knockoff

**A browser extension that filters pseudo-brand junk out of Amazon.** Buy from
real, established brands, even when that means paying more.

Amazon is flooded with trademark-squat "brands" (SZHLUX, HORUSDY, LATTOOK,
DOZAWA...): random strings registered at the USPTO purely to unlock Amazon
Brand Registry, selling commodity goods with no company, no warranty, and no
reputation behind them. Knockoff detects those listings and hides, dims, or
labels them, right in the search results.

## Install

**[Add to Chrome](https://chromewebstore.google.com/detail/pjgickchbiikhdfpmecaabkphmofpdce)** from the Chrome Web Store, or
**[Add to Firefox](https://addons.mozilla.org/en-US/firefox/addon/knockoff-amazon-brand-filter/)** from Firefox Add-ons.

Or load it unpacked for development:

1. Clone this repo
2. Open `chrome://extensions`
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked** and select the repo folder

Works on every Amazon marketplace.

### Safari

Safari requires the extension to be wrapped in a native app. Open
[`safari/Knockoff/Knockoff.xcodeproj`](safari/Knockoff) in Xcode, run the
**Knockoff** scheme, then enable Knockoff in Safari → Settings →
Extensions. For unsigned local builds, first check "Allow unsigned
extensions" in Safari's Develop menu.

The Xcode project carries its own copy of the extension files; after
editing the extension, run [`scripts/sync-safari.sh`](scripts/sync-safari.sh)
to update it before rebuilding.

## Press

Some of the coverage since launch:

- [Fast Company](https://www.fastcompany.com/91570721/amazon-shopping-slop-viral-new-tool-filters-out-knockoff-brands)
- [Gizmodo](https://gizmodo.com/new-browser-extension-helps-you-dodge-amazons-sea-of-knock-off-products-2000783054)
- [404 Media](https://www.404media.co/knockoff-browser-extension-hides-sketchy-brands-on-amazon/)
- [PC Gamer](https://www.pcgamer.com/hardware/this-chrome-extension-hides-knockoff-brands-on-amazon-sorry-to-brands-like-wnpethome-eheyciga-yxy/)
- [Yahoo](https://tech.yahoo.com/apps/articles/chrome-extension-removes-unknown-brands-162002361.html)

## How it works

Everything runs locally in a content script. No accounts, no tracking, no
server round-trips on the shopping path. Each product tile's brand is
resolved through this pipeline (first match wins):

| # | Check | Verdict |
|---|-------|---------|
| 1 | Your allowlist | `allowed`, never filtered |
| 2 | Your blocklist | `blocked`, always filtered |
| 3 | Seed list of notorious pseudo-brands ([`data/flagged-brands.js`](data/flagged-brands.js)) | `flagged` |
| 4 | Established Chinese-owned brands ([`data/chinese-major.js`](data/chinese-major.js)) | `known`, or `flagged` if you enable that setting |
| 5 | ~5,000 established brands ([`data/known-brands.js`](data/known-brands.js) + the community allowlist in [`data/community-brands.js`](data/community-brands.js), refreshed daily from `api.knockoff.shopping/brands`) | `known` |
| 6 | Name heuristics (see below) | `flagged` / `suspect` / `unknown` |
| - | No brand at the front of the title at all | `unbranded` |

### Name heuristics

Unknown brands are scored on the linguistic signature of trademark-squat
names: ALL-CAPS 5–9 character strings, vanishing vowel ratios,
unpronounceable consonant runs, un-English letter pairs, non-Latin
characters, random iNternal caPitalization. High scores are `flagged`,
mid scores `suspect`. The known-brands list always vetoes the heuristics:
plenty of real brands (ASICS, RYOBI, HOKA) would otherwise look suspicious.
Scoring lives in [`src/detector.js`](src/detector.js) and is deliberately
readable, and tuning it is a great first contribution.

### Filter levels

| Level | Filters |
|-------|---------|
| **Relaxed** | Known pseudo-brands + your blocklist |
| **Standard** (default) | + suspect-looking names + unbranded listings |
| **Strict** | + anything not on a known-brands list (allowlist-only) |

### Actions

Filtered items can be **hidden** (with a floating pill showing the count and
a one-click reveal), **dimmed** (fade + desaturate, restore on hover), or
just **labeled**. Every badge is clickable: trust the brand, block it, show
the item once, or report a misclassification.

Product detail pages get a verdict chip next to the brand byline. The page
is never hidden out from under you.

## Reporting misclassifications

The badge menu has one-click reporting ("this is junk" / "this is a real
brand"). Reports go to a tiny Cloudflare Worker backed by D1
([`report-worker/`](report-worker/)) and are reviewed by hand to improve the
bundled lists. No PII: the payload is brand, verdict, ASIN, marketplace, and
extension version; reporter IPs are stored only as salted hashes for rate
limiting. If no endpoint is configured the extension falls back to opening a
prefilled GitHub issue.

Deploying your own endpoint is four commands; see the header of
[`report-worker/worker.js`](report-worker/worker.js).

## Contributing

The easiest, highest-value contributions are brand list fixes; see
[CONTRIBUTING.md](CONTRIBUTING.md). There is no build step; the extension is
plain JavaScript, loadable directly from the repo.

```
manifest.json             MV3 manifest
data/known-brands.js      curated established brands (edit this one!)
data/chinese-major.js     established Chinese-owned brands (toggleable)
data/flagged-brands.js    seed blocklist of notorious pseudo-brands
data/generic-words.js     common title words, for unbranded detection
data/community-brands.js  bundled community allowlist snapshot (generated, don't edit)
src/detector.js           detection engine (pure logic, no DOM)
src/content.js            page scanning, badges, actions, in-page control panel
src/background.js         toolbar button → panel toggle (or options page)
options/                  settings page (rules, allow/blocklist)
report-worker/            Cloudflare Worker: reports, curation, brand-list API
safari/                   Xcode wrapper app for Safari (macOS)
site/                     knockoff.shopping landing page (static, Cloudflare)
store-assets/             Chrome Web Store images + the HTML frames that render them
scripts/                  maintenance scripts
```

## Known limitations

- **Mixed-case gibberish** ("Geinxurn", "Mulwark") scores below the suspect
  threshold at standard level; Strict mode catches it. A bundled character
  bigram model would fix this properly; PRs welcome.
- Seller **country-of-origin lookup** (fetching seller profile addresses) is
  deliberately not implemented: it costs two rate-limited page fetches per
  product and Amazon 503s aggressive scrapers. The name-based approach needs
  zero network calls.
- Carousels and a few exotic tile layouts aren't scanned yet
  (`TILE_SELECTORS` in `src/content.js` is the extension point).
- Non-English stores are best-effort. Brand lists and the product-page chip work
  everywhere, but the name heuristics are English-tuned, so an unlisted local
  brand can slip through. Non-Latin listings (Japanese, Arabic) are skipped rather
  than mis-filtered, so nothing breaks on any marketplace.

## Prior art

Research that shaped this design: [AmazonBrandFilter](https://github.com/chris-mosley/AmazonBrandFilter)
(allowlist approach; its MIT-licensed community list seeded Knockoff's own),
[SoldBy](https://github.com/tadwohlrapp/soldby)
(seller-country lookup and its rate-limit lessons), and The Markup's
[Amazon Brand Detector](https://github.com/the-markup/tool-amazon-brand-detector).
Knockoff's contribution is combining a community allowlist with a
heuristic scorer, with the allowlist as veto.

## License

[FSL-1.1-MIT](LICENSE). Code converts to MIT after two years.
