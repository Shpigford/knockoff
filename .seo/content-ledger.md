# Knockoff — Content Ledger

> The memory of the content engine. Read on every SEO/content run: the **Shipped** table is
> the dedup record (never re-write a covered topic); the **Candidate backlog** is the scored
> shortlist so each run starts warm. Update in the same batch as every piece shipped.

## Shipped

| Date | Title | Type | URL | Target keyword (cluster) | ~Vol/mo (US) | KD | Internal links | Notes |
|---|---|---|---|---|---|---|---|---|
| 2026-07-08 | Fakespot is gone. Here's what to use instead. | comparison/alternatives | /fakespot-alternative | "fakespot" + "fakespot alternative/replacement/shut down" cluster | ~16k combined | 0 | /amazon-fake-brands, /, stores | Honest comparison incl. FakeFind. Article + FAQPage JSON-LD. |
| 2026-07-08 | Why is Amazon full of brands like SZHLUX? | explainer / link magnet | /amazon-fake-brands | "amazon fake brands" / "fake brands on amazon" (+ "does amazon sell fake products" as FAQ) | ~300 (+400 FAQ) | 8–13 | /fakespot-alternative, /, stores | Cites USPTO + Fortune trademark-surge data. The page journalists should cite. |
| 2026-07-08 | How to hide sponsored products on Amazon | how-to / feature page | /hide-amazon-sponsored-products | "what does sponsored mean on amazon" + "sponsored products on amazon" | ~1.3k | 0–1 | /amazon-fake-brands, /, stores | Covers uBlock DIY route honestly. |

## Candidate backlog (scored, not committed)

| Idea | Target keyword | ~Vol/mo | KD | Fit | Notes |
|---|---|---|---|---|---|
| "Most-flagged pseudo-brands on Amazon" data/stats page | (link magnet, not keyword play) | — | — | ⭐ best | Unique data: flagged lists + community reports. Recurring citation target for press. Respect editorial rule #3 (facts, not accusations). Needs a stats endpoint or periodic regeneration. |
| **Brand checker web tool** (paste a brand name → Knockoff's verdict) | amazon brand checker / "is [brand] legit" long tail | low head, big tail | ~0 | ⭐ strong | Engineering-as-marketing (KeptWell's free-tool play). The detector is dependency-free plain JS with zero DOM access — it can run client-side on knockoff.shopping unchanged. Perfect product demo + shareable. Frame verdicts as heuristic scores + list membership per editorial rule #3. Possible later pSEO layer (/brand/[slug] pages) is high-tail but defamation-sensitive — needs its own review before building. |
| Standalone "does Amazon sell fake products?" explainer | does amazon sell fake products | 400 | 6 | good | Currently an FAQ on /amazon-fake-brands. Break out only if GSC shows impressions without clicks; avoid cannibalizing. |
| Amazon ad blocker angle | amazon ad blocker | 90 | 0 | ok | Small; could be a secondary keyword folded into /hide-amazon-sponsored-products rather than a new page. |
| Review-checker comparison content | amazon review checker | 7.5k | 40 | weak for now | KD 40 over the cap, and it's not our product category. Revisit only after DR > 15, and only as honest roundup. |
| Per-marketplace pages (amazon.co.uk / .de …) | localized variants | ? | ? | later | Only after US pages prove out in GSC. |

## Considered, dropped, with reason

(KeptWell's convention: record what was rejected and WHY so future sessions don't relitigate.)

- **"amazon review checker" as a page target** — 7.5k/mo but KD 40 (over the ladder) and it's not our feature; covered as an honest pointer to FakeFind on /fakespot-alternative instead.
- **Per-marketplace localized pages** — premature before US pages have GSC data.
- **Drug-interaction-checker-style "junk brand database" with accusations** — defamation exposure; only ship brand pages as heuristic scores + checkable facts, if ever.

## Do-not-write (dedup floor)

- Anything re-covering the three shipped pages' clusters (Fakespot, fake-brands explainer, sponsored how-to) — extend those pages instead.
- Review-grading how-tos that imply Knockoff reads reviews (anti-positioning #1).

## Off-page / pending manual steps (as of 2026-07-08)

- [ ] Google Search Console: verify domain, submit sitemap, request indexing on all 4 pages
- [ ] Bing Webmaster Tools: import from GSC
- [ ] AlternativeTo: list Knockoff (Fakespot alternatives page)
- [ ] ProductHunt: get onto the Fakespot alternatives listing
- [ ] Re-check DR after Ahrefs recalculates the July link wave; update config.json
