# Release notes

Canonical "what's new" copy for each release — the text that goes in the Chrome
Web Store "Release notes" field, the AMO version notes, and the App Store
Connect "What's New" field. Newest first. Move items out of **Unreleased** into a
version heading when you cut a release.

## Unreleased

## 0.6.0

- New: installing Knockoff now opens a quick welcome page that confirms it's on
  and lets you see it work on a live Amazon search, instead of dropping you into
  a settings form.
- New: the first time Knockoff filters a search, a one-time toast confirms it's
  working and points out the toolbar button.
- Changed: the Mac, iPhone, and iPad app icons now use the new red price-tag
  mark, matching the browser extension.

## 0.5.1

- Fixed: real brands are no longer dimmed on Amazon's newer search layout,
  where the brand sits on its own line above the product title (fixes Sony,
  SmallRig, and similar "[brand] [product]" searches).
- Improved: Knockoff can now adapt to Amazon layout changes without waiting for
  a store update, so filtering keeps working when Amazon reshuffles its page
  structure.
- Changed: Knockoff's website has moved to knockoff.co.

## 0.5.0

- New: Knockoff now runs on mobile — Firefox for Android, and Safari on
  iPhone and iPad.
- New: filter by minimum star rating and review count, so poorly-rated or
  barely-reviewed listings drop out alongside pseudo-brands.
- New: when you report a misclassification, you can now name the brand you
  expected, so corrections land faster.
- New: pseudo-brands are now filtered on Amazon's "Keep shopping for"
  recommendation grids, not just the main search results.
- Improved: Knockoff now reads the brand from Amazon's dedicated byline, not
  just the product title, for more accurate detection.
- Improved: certification and compatibility brackets at the start of a title
  (like "[FCC Certified]") are no longer mistaken for the brand.
- Improved: allowlisted brands are now recognized even when buried inside
  category-page titles.
- Improved: fewer false flags — short vowelless acronyms like CCT and RGB read
  as unbranded, and accented words like German compounds are no longer misread
  as pseudo-brands.
- Improved: expanded the built-in brand lists so more real brands are
  recognized on sight.
- Improved: more media titles (books, music, movies) are skipped on
  all-departments searches.
- Changed: dimmed listings now stay dimmed when you hover; only an explicit
  un-hide reveals them.
- Changed: refreshed app icon and in-app logo with the new red price-tag brand
  mark.

## 0.4.0

- New: the control panel now lists every brand it filtered on the current
  search, each with one-click buttons to allow or block it.
- New: back up and restore your settings — filter level, allow and block
  lists, and preferences — as a JSON file from the options page.
- New: on product pages, Knockoff now warns when the seller's name looks
  like a trademark-squat pseudo-brand.
- New: the settings page opens automatically the first time you install
  Knockoff.
- Improved: category words you search for are no longer dimmed by the
  detection heuristics.
- Fixed: Bibles are no longer flagged on all-departments searches.

## 0.3.0

- New: media and digital categories (Books, Kindle, Audible, music, movies,
  apps) are now skipped entirely — titles there are works, not brand names, so
  nothing gets wrongly filtered.
- New: the options page now includes the core filter controls (filter level,
  action, and related settings), so you can adjust Knockoff without opening an
  Amazon page.
- New: refresh the community brand list on demand from the options page
  instead of waiting for the daily update.
- Improved: the "hide Sponsored listings" option now also removes sponsored
  widget carousels and works on non-English marketplaces.
- Improved: brand detection — model numbers (like CR2032), metric fastener
  sizes (like M6), and generic words like "Heat" are no longer mistaken for
  brands; fewer false flags on real golf brands; and unlisted brands that
  name-drop Apple or Samsung hardware are now caught.
- Fixed: control-panel menus now close when you click outside them.
- Mac: now supports macOS 11 Big Sur and later (previously required a much
  newer macOS).

## 0.2.0

- New: works on every Amazon marketplace (Germany, France, Italy, Spain,
  Japan, India, Mexico, Brazil, and more) with locale-aware brand detection.
  Previously only .com, .ca, .co.uk, and .com.au.
- New: optional toggle to hide Amazon "Sponsored" listings, in the Knockoff
  control panel. Off by default; leaves organic results (and Amazon's own
  "Featured from Amazon brands" tiles) untouched.
- Changed: filtered listings are now dimmed by default instead of hidden, so
  you can see what Knockoff caught. Prefer them gone? Switch the action to
  Hide in the control panel.

## 0.1.0

- Initial release. Filters trademark-squat pseudo-brands out of Amazon search
  results with hide / dim / label actions, three filter levels (Relaxed,
  Standard, Strict), personal allow/block lists, and one-click misclassification
  reporting. Runs locally; the only network request is a daily brand-list
  refresh. Works on amazon.com, .ca, .co.uk, and .com.au.
