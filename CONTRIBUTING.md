# Contributing to Knockoff

Thanks for helping. Most contributions are one-line brand list edits. You
don't need to know Chrome extension development to make the filter better.

## Adding or fixing a brand

**A real brand is being filtered** → add it to `data/known-brands.js`, in the
matching category section, keeping rough alphabetical order within the line
groups. The bar for "established": a real company with a track record, its
own website, a warranty, and a reputation to lose. Age helps; quality is not
the bar (cheap-but-real brands belong on the list; users who disagree can
personally block them).

**A pseudo-brand is getting through** → add it to `data/flagged-brands.js`.
Reserve this for prolific offenders; the heuristics catch the long tail, and
blocklists are a losing race by design.

**An established Chinese-owned brand** (real company, real reputation:
Anker, DJI, Roborock tier) → `data/chinese-major.js`. These pass by default;
a user setting flags them.

**A generic word is being read as a brand** ("Flexible Nut Driver…" →
brand "Flexible") → add the word to `data/generic-words.js`.

Matching is case-insensitive on lowercased alphanumerics ("Black+Decker" ≡
"blackdecker"), so don't add capitalization or punctuation variants. Brands
already in the bundled community snapshot (`data/community-brands.js`) don't
need duplicating here.

## Testing your change

No build step. After editing:

1. `chrome://extensions` → Knockoff → reload (↻)
2. Reload an Amazon search page that reproduces the case
3. Every processed tile carries `data-ko-verdict` and `data-ko-brand`
   attributes. Inspect element to see exactly what the detector decided,
   and click the badge for the human-readable reason

Quick logic check without the browser: `node tests/run.js` exercises the
detector against a fixture set of real titles.

## Tuning the heuristics

`src/detector.js` → `scoreBrand()`. Rules of thumb:

- False negatives (junk passing) are recoverable via Strict mode, the blocklist,
  and reports. False positives (real brands filtered) erode trust in the whole
  extension. Bias accordingly.
- The known-brands list always vetoes heuristics, so a new signal only needs
  to be safe for brands *not* on any list.
- If you add a signal, add a fixture case to `tests/fixtures.js` showing
  what it catches.

## Reporting data

One-click reports from the badge menu land in a D1 table (see
`report-worker/`). Maintainers triage on the `/review` dashboard, where a
Block/Trust click curates the brand, and curated verdicts are served by the API
(`/flagged`, merged into `/brands`) and reach every install within its next
daily refresh, no extension release needed. Brands that prove permanent
should still graduate into the bundled data files so fresh installs are
covered before their first refresh. Endpoints are documented in
`report-worker/worker.js`.

## Pull requests

- Keep PRs small and single-purpose (one brand-list theme, one heuristic,
  one fix).
- For anything user-visible, include a before/after screenshot or the search
  query that demonstrates it.
- Match the existing code style: plain ES5-ish JavaScript, no frameworks,
  no build tooling, comments explain *why*.
