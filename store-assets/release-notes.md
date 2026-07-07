# Release notes

Canonical "what's new" copy for each release — the text that goes in the Chrome
Web Store "Release notes" field, the AMO version notes, and the App Store
Connect "What's New" field. Newest first. Move items out of **Unreleased** into a
version heading when you cut a release.

## Unreleased

- New: optional toggle to hide Amazon "Sponsored" listings, in the Knockoff
  control panel. Off by default; leaves organic results (and Amazon's own
  "Featured from Amazon brands" tiles) untouched.

## 0.1.0

- Initial release. Filters trademark-squat pseudo-brands out of Amazon search
  results with hide / dim / label actions, three filter levels (Relaxed,
  Standard, Strict), personal allow/block lists, and one-click misclassification
  reporting. Runs locally; the only network request is a daily brand-list
  refresh. Works on amazon.com, .ca, .co.uk, and .com.au.
