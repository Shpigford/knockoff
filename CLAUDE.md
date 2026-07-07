# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Knockoff is a cross-browser MV3 extension (Chrome/Firefox/Safari) that filters trademark-squat pseudo-brands out of Amazon search results. Plain classic JavaScript — **no build step, no dependencies, no frameworks, no modules**. The repo root IS the extension; load it unpacked at `chrome://extensions`.

## Commands

- **Run tests:** `node tests/run.js` — the only test command. No test framework; it loads the data files + detector into a `vm` sandbox and checks every fixture in `tests/fixtures.js`. There is no lint step.
- **Manual verification:** reload the extension at `chrome://extensions`, reload an Amazon search page. Every processed tile carries `data-ko-verdict` / `data-ko-brand` attributes; click a badge for the human-readable reason.
- **Sync Safari wrapper:** `scripts/sync-safari.sh` — the Xcode project (`safari/Knockoff/`) carries its own copy of the extension files; run this after editing `manifest.json`, `src/`, `data/`, `options/`, or `icons/`, before rebuilding in Xcode. Also bumps the app's marketing version from `manifest.json`.
- **Cut a release (all stores):** the `/release` skill (`.claude/skills/release/SKILL.md`) — bumps `manifest.json`, rolls `store-assets/release-notes.md`, tags `v<version>`, then ships Chrome + Firefox + Safari. The store-specific commands below are what it orchestrates.
- **Package for Chrome Web Store:** `scripts/package.sh` (version read from `manifest.json`). Actual CWS release is the manual-dispatch GitHub Action `cws-release.yml`; check status with `scripts/cws-status.sh`.
- **Firefox / AMO release:** `scripts/release-firefox.sh` — lints and submits a listed version via `web-ext`, pulling version notes from `store-assets/release-notes.md`; needs `.env.amo` (see `.env.amo.example`).
- **Safari App Store release:** `scripts/release-safari.sh` (archive + upload), then `scripts/submit-appstore.rb`.
- **Refresh bundled community list:** `scripts/update-bundled-brands.sh` regenerates `data/community-brands.js` from the live `/brands` endpoint (generated file — never hand-edit). `/release` runs it at release time.
- **Deploy workers:** `wrangler deploy` inside `report-worker/` or `site/`. First-time D1/secret setup is documented in the header of `report-worker/worker.js`.

## Architecture

### Content-script pipeline (load order matters)

All files in `manifest.json`'s `content_scripts.js` are classic scripts sharing one page scope, loaded in order: the five `data/*.js` files define global brand arrays → `src/detector.js` consumes them into the global `Knockoff` object → `src/content.js` drives everything. Adding a data file means adding it to `manifest.json` AND to the load list in `tests/run.js`.

- **`src/detector.js`** — the detection engine. Pure logic, zero DOM access, unit-testable. Exposes `Knockoff.buildIndexes()` and `Knockoff.classify(title, settings, userAllow, userBlock)`.
- **`src/content.js`** — all DOM work: tile scanning (`TILE_SELECTORS` is the extension point for new layouts), badges, hide/dim/label actions, in-page control panel, misclassification reporting, and the daily runtime refresh of the community list + curated flags from `api.knockoff.shopping`.
- **`src/background.js`** — trivial; toolbar button → panel toggle.
- Brand matching is on normalized keys: lowercase alphanumerics only (`"Black+Decker"` ≡ `"blackdecker"`). Never add capitalization/punctuation variants to the data files.

### Verdict pipeline (first match wins)

user allowlist → user blocklist → seed blocklist (`data/flagged-brands.js`) → Chinese-major list (`known`, or `flagged` if the user enables that setting) → known-brands lists (`data/known-brands.js` + `data/community-brands.js` + daily-refreshed community list) → name heuristics (`scoreBrand()`: score ≥ 6 `flagged`, ≥ 3 `suspect`, else `unknown`) → no brand at all = `unbranded`. Filter levels (relaxed/standard/strict) decide which verdicts get acted on; strict is allowlist-only.

Media/digital categories (Books, Kindle, Audible, music, movies, apps…) are skipped before any of this: their titles are works, not brand-led product names. `content.js` reads the page's department (`#searchDropdownBox` value, URL `i=` fallback) and sits out when `Knockoff.isMediaAlias()` matches.

**The known-brands list always vetoes the heuristics** — real brands like ASICS, HOKA, RYOBI would otherwise look like gibberish. So a new heuristic signal only needs to be safe for brands *not* on any list.

### Server side (all optional to the shopping path)

- **`report-worker/`** — Cloudflare Worker + D1 at `api.knockoff.shopping`: accepts one-click misclassification reports, serves the community allowlist (`/brands`, D1-backed and edge-cached; the base list was seeded once from `seed-brands.sql`, and `data/community-brands.js` is its bundled snapshot, regenerated at release time) and curated blocklist additions (`/flagged`), and hosts a token-gated `/review` curation dashboard. Curated verdicts reach installs on their next daily refresh — no extension release needed. Endpoints documented in `worker.js` header.
- **`site/`** — static landing page (Cloudflare Worker assets) at knockoff.shopping.

Everything else runs locally in the content script; the extension's only first-party network dependency is `api.knockoff.shopping`.

## Conventions and judgment calls

- Match the existing style: plain ES5-ish JavaScript (`var`, IIFEs, function declarations), comments explain *why*.
- **False positives (real brands filtered) are worse than false negatives (junk passing).** Junk that slips through is recoverable via Strict mode, blocklists, and reports; filtering a real brand erodes trust in the whole extension. Bias heuristic tuning accordingly.
- When adding a heuristic signal to `scoreBrand()`, add a fixture to `tests/fixtures.js` showing what it catches.
- Brand list placement: real established brands → `data/known-brands.js` (keep rough alphabetical order within category sections); prolific pseudo-brand offenders only → `data/flagged-brands.js` (heuristics catch the long tail); established Chinese-owned brands (Anker/DJI tier) → `data/chinese-major.js`; generic title words misread as brands → `data/generic-words.js`.
- Seller country-of-origin lookup is deliberately not implemented (rate-limit lessons from prior art) — don't add network calls to the shopping path.
