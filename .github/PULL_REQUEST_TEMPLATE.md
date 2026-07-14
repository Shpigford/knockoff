<!-- Keep PRs small and single-purpose: one brand-list theme, one heuristic, or one fix. -->

## What & why


## Checklist

- [ ] `node tests/run.js` passes locally
- [ ] Brand entries are in the right file per [CONTRIBUTING](../CONTRIBUTING.md) — real brand → `known-brands`, pseudo-brand → `flagged-brands`, established Chinese-owned → `chinese-major`, generic word → `generic-words`. No case/punctuation variants of an entry already present ("Black+Decker" ≡ "Black & Decker").
- [ ] Added a fixture to `tests/fixtures.js` if I touched a heuristic
- [ ] For a user-visible change: attached a before/after screenshot or the Amazon search query that demonstrates it
