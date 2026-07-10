# Knockoff — Brand Context for SEO

> Read every time. This file is read at the start of every SEO/content session. The article
> template lives in `site/public/fakespot-alternative.html` — copy it for new pages.

## Product

- **Name:** Knockoff
- **One-liner (≤20 words):** A free browser extension that filters trademark-squat pseudo-brands out of Amazon search results.
- **What we do:** On every Amazon search page, Knockoff checks each listing's brand against a register of 5,500+ established brands (refreshed daily), scores unknown names against the linguistic signature of pseudo-brands (ALL-CAPS squat-length strings, vanishing vowels, consonant runs), and hides, dims, or labels the junk — user's choice of three strictness levels. Everything runs locally in the browser; the only network call is a daily brand-list refresh. One-click misclassification reports feed a community list that reaches every install within a day.
- **Pricing:** Free. Fair-source (FSL-1.1-MIT, converts to MIT after two years). No accounts, no tracking.
- **Platforms:** Chrome (Web Store), Firefox (AMO), Safari (Mac App Store). Chromium browsers install from the Chrome listing. Works on every Amazon marketplace.

## Audience

- **Primary personas:** (1) The **burned Amazon shopper** — bought SZHLUX-grade junk once, now distrusts the whole results page and wants real brands back. (2) The **ex-Fakespot user** — lost their review checker when Mozilla killed it (July 1, 2025) and is looking for anything that restores trust while shopping.
- **Secondary persona:** The HN-reader tech early adopter — privacy-conscious, reads the source, allergic to hype; this is who the July 2026 viral wave brought in.
- **Jobs to be done:**
  1. "Stop making me research every gibberish brand — just show me listings from companies with a reputation to lose."
  2. "Tell me at a glance which results are junk, and let me overrule you when you're wrong."
  3. "Get the sponsored ads out of my results while you're at it."

## Competitors (ordered by search demand, not similarity)

Key finding (July 2026): the biggest demand is **escape-from** — Fakespot is dead and its
navigational + "alternative" queries (KD ~0) dwarf everything else in the niche. Direct
brand-filtering competitors barely exist as search targets.

| Brand | Status | Relationship | Notes |
|---|---|---|---|
| Fakespot | Dead (Mozilla shut it down 2025-07-01) | Escape-from, flagship target | Review grader, not a brand filter. `/fakespot-alternative` owns this cluster. Be honest that we do a different job. |
| FakeFind (fakefind.ai) | Active | Adjacent, not direct | Review checker chasing the Fakespot gap. We link to them honestly on `/fakespot-alternative` — different job (reviews vs. brands), and the honesty is the positioning. Don't trash them. |
| ReviewMeta | Dormant | Historical reference | Still recommended in old forum threads; describe as dormant, don't claim it's dead without re-checking. |
| uBlock Origin custom filters | Active | DIY substitute (sponsored-ads feature only) | Cover honestly as the free DIY route with a maintenance cost. |

## Brand voice

- **Voice tags:** dry, confident, concrete, plain-spoken, honest about limits, a little wry. Calm, never hysterical — the product's whole posture is "appraisal, not outrage."
- **Person/perspective:** direct address ("you"); the product speaks for itself in short declaratives. "We" sparingly, and "that's us" transparency when recommending ourselves on comparison pages.
- **Reference tone:** the existing site copy is the standard ("brands with a reputation to lose," "Built like a tool, not a toy"). External references: Linear's directness, 37signals' plainspokenness.
- **The two-sided rewrite test (KeptWell's device):** if it sounds like a consumer-safety press release, rewrite it. If it sounds like a Reddit rant about Chinese sellers, rewrite it too. The voice lives between those failure modes: an appraiser, not an advocate and not a ranter.
- **Canonical phrasing (brand anchors — variations fine, these are the reference):**
  - "Amazon, without the knockoffs."
  - "brands with a reputation to lose"
  - "trademark-squat pseudo-brands"
  - "Every verdict is one click from being overridden."
- **Forbidden words/phrases:** "seamlessly," "revolutionary," "effortless," "game-changing," "unlock," "supercharge," "elevate," "robust," "leverage" (verb), "in today's fast-paced world," "it's not just X, it's Y." No fake urgency, no emoji in body copy.

### Copy mechanics (the AI-tell guard)

Granite learned this the hard way: its em-dash preference lived only in a sprint log, so half
its library follows it and half doesn't. Mechanics live here so they apply to every piece.

- **Em-dashes: rationed.** The house voice barely uses them (the homepage has 2 total). Cap:
  about one per section, never two in a sentence, never as the default connector. Prefer
  periods, colons, and parentheses. A page with 10+ em-dashes reads as AI-written; rewrite it.
- **Short declaratives are the house rhythm.** "Your call." "Done." Contractions welcome.
- **Sentence case everywhere** — headings, buttons, chips ("How it works", not "How It Works").
  One exception: `<title>` tags may use Title Case (SERP convention); the visible H1 stays
  sentence case. Em-dashes in `<title>` tags are fine too — they're display separators, not prose.
- **Banned constructions:** "But here's the thing," "Let's dive in," "In short" section
  openers, rhetorical-question headings back-to-back, triads-for-the-sake-of-triads.
- **No exclamation points** unless something is genuinely surprising (it almost never is).
- **Every number traces to a source.** Claim-ledger discipline: stats get a primary-source
  link or they don't ship. No invented round numbers, no "studies show."

### Editorial rules with teeth (product-grounded, not taste)

1. **Never call pseudo-brands "counterfeit."** They're legally registered trademarks on generic goods — a different problem from counterfeits. The precision is a credibility asset; every explainer should make the distinction.
2. **Never imply Chinese = junk.** Anker/DJI-tier companies are established brands and the extension treats them as such (`data/chinese-major.js` exists for exactly this). The dividing line is disposability, not geography.
3. **Never accuse a specific named brand of fraud or fake reviews.** State checkable facts ("on the community list," "no web presence outside Amazon," "flagged by N reports") — not accusations. Same principle as the code: false positives are worse than false negatives, and in content the false positive is defamation.
4. **Admit the heuristic's fallibility everywhere.** "Every verdict is one click from being overridden" is a feature; say it.

## Anti-positioning (where we don't compete — admit it)

1. **Not a review checker.** Knockoff never reads reviews. If someone wants per-product review grading, point them to a review checker (we do, by name, on `/fakespot-alternative`).
2. **Not a counterfeit detector.** We can't tell you if that "Nike" is real Nike.
3. **Not a price tracker or deal tool.** No price history, no alerts.
4. **No seller country-of-origin data.** Deliberately not implemented (rate-limit lessons from prior art); don't promise it in content.
5. **Verdicts are heuristics + lists, not ground truth.** Correctable by design.

## Concrete differentiators

1. **Filters at the search-results level, before you click** — review tools only help after you've opened a listing.
2. **Runs locally.** No accounts, no tracking; the shopping path makes zero network calls (one daily list refresh).
3. **Community fixes ship daily** without an extension update.
4. **User lists always win.** Personal trust/block lists override every other signal.
5. **Fair-source and readable in an afternoon** — no build step; the brand lists are plain text files, so a fix is a one-line PR.

## Visual brand (for content pages)

- **Surface:** paper `#fafafa`; cards `#ffffff` with 1px `#e4e4e7` borders, 12–20px radii.
- **Ink:** `#101012`; secondary `#52525b`; tertiary `#71717a`.
- **Accent:** red `#dc2626` (hover `#b91c1c`). Verdict colors: red = flagged, amber `#f59e0b` = suspect, green `#047857` = known.
- **Type:** Bricolage Grotesque (Google Fonts) for display/headings/buttons, tight tracking; system sans for body.
- **Motifs:** the punched-hole price-tag chip (the logo mark), browser-frame product demos, dark `#101012` band/CTA sections with the rotated red square.
- **Implementation:** plain HTML, inline CSS per file, no build step. New article = copy `site/public/fakespot-alternative.html`, keep nav/footer/CTA identical, add the page to `site/public/sitemap.xml` and to every page's footer links.

## Links to existing surfaces

- Home: https://knockoff.shopping/
- Guides: `/fakespot-alternative` · `/amazon-fake-brands` · `/hide-amazon-sponsored-products`
- Privacy: `/privacy`
- Chrome: https://chromewebstore.google.com/detail/pjgickchbiikhdfpmecaabkphmofpdce
- Firefox: https://addons.mozilla.org/en-US/firefox/addon/knockoff-amazon-brand-filter/
- GitHub: https://github.com/Shpigford/knockoff
