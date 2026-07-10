# Knockoff — Internal Link Inventory

> Link targets and preferred anchors for content pages. Every new article: ≥2 in-body links
> to product surfaces (varied anchors, no bare "click here") and ≥1 inbound link added from
> an existing page. Every page appears in the shared footer (all pages carry the same footer
> — update all of them together).

## Product surfaces

| URL | Use when | Anchor ideas |
|---|---|---|
| `/` | any product mention | "Knockoff", "how it works", "see how it works" |
| `/privacy` | privacy/tracking claims | "privacy policy", "no tracking" |
| Chrome store | install CTAs | "Add to Chrome" (button, not in-body) |
| Firefox AMO | install CTAs | "Add to Firefox" |
| GitHub repo | fair-source / code claims | "on GitHub", "the source", "fair-source" |

## Content pages

| URL | Topic owned | Link to it when… |
|---|---|---|
| `/fakespot-alternative` | Fakespot shutdown + replacements | any mention of Fakespot, review checkers, "review tools" |
| `/amazon-fake-brands` | why pseudo-brands exist (trademark loophole) | any mention of SZHLUX-style names, pseudo-brands, Brand Registry, disposable brands |
| `/hide-amazon-sponsored-products` | sponsored ads + hiding them | any mention of sponsored results, Amazon ads |

## Standing structure

- All pages share the same footer link set (stores, GitHub, three guides, privacy, @Shpigford).
- New page checklist: canonical tag → Article (+FAQPage if FAQ) JSON-LD → add to `sitemap.xml` → add to every page's footer → ≥1 in-body inbound link from the most related existing page.
