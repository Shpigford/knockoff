---
name: release
description: Cut a new Knockoff release — bump the version, roll release notes, tag, and ship to the Chrome Web Store, Firefox Add-ons (AMO), and the Mac App Store, reporting per-store status at the end.
---

# Knockoff release

Ships one version to all three stores. `manifest.json` `.version` is the single
source of truth; everything else (Safari `MARKETING_VERSION`, the CWS version
gate, release notes headings, the git tag) keys off it.

## Step 0 — Preflight (before asking the user anything)

Run all of these; collect failures instead of stopping at the first one.

1. Git: working tree clean, on `main`, and in sync with `origin/main`
   (`git fetch origin && git status`). Dirty tree or unpushed/unpulled commits
   = hard stop.
2. Tests: `node tests/run.js` must pass.
3. Listing gate: `node scripts/render-listing.js --check` must pass.
4. Firefox lint: `./scripts/release-firefox.sh --lint-only` must exit 0
   (warnings are fine; errors block).
5. Credentials, per store:
   - **Chrome:** `gh auth status` works. The five `CWS_*` GitHub secrets are
     assumed present (uploaded via `scripts/upload-secrets.sh`); local
     `.env.cws` is only needed for status checks.
   - **Firefox:** `.env.amo` exists with `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`
     (see First-run setup below).
   - **Safari:** running on macOS; `.env.asc` exists with `ASC_KEY_ID`,
     `ASC_ISSUER_ID`, and the `.p8` at `ASC_KEY_FILE` (or the default
     `~/.appstoreconnect/AuthKey_<KEY_ID>.p8`); Xcode signed into team
     `W33JZPPPFN`.

If a store's credentials are missing, do not silently skip it — tell the user
what's missing and ask whether to release without that store or abort.

## Step 1 — Decide the version (ask the user)

1. Find the last release: latest `git tag -l 'v*' | sort -V | tail -1`. If no
   tags exist yet (first skill-driven release), use the commit that last
   changed the `"version"` line in `manifest.json`
   (`git log -1 -S'"version"' --format=%H -- manifest.json`).
2. List commits since then: `git log <ref>..HEAD --oneline`.
3. Suggest a bump: new user-visible features → minor; only fixes/tweaks →
   patch; anything ambiguous → ask.
4. Ask the user ONE consolidated question round: (a) version — Patch / Minor /
   Major / Custom, with the suggested option first and the commit list shown;
   (b) Apple release timing — MANUAL (default; you click "Release" in App
   Store Connect after approval) or AFTER_APPROVAL (auto-release).

## Step 2 — Release notes

File: `store-assets/release-notes.md` (canonical "what's new" for all three
stores; AMO notes are read from it automatically by `release-firefox.sh`).

1. Check `## Unreleased` covers every user-visible change since the last
   release. Draft missing entries from the commit list — user-facing prose in
   the style of the existing entries ("New: …", plain English, no commit
   prefixes, drop internal/infra changes entirely).
2. Show the final notes to the user and confirm before writing.
3. Roll: rename `## Unreleased` to `## <version>` and insert a fresh empty
   `## Unreleased` above it.

Never skip this step, even for a "trivial" release.

## Step 3 — Bump, commit, tag, push

1. Edit `manifest.json` `.version` to the new version.
2. Run `./scripts/update-bundled-brands.sh` — bakes the current curated
   community list into `data/community-brands.js` so fresh installs start
   with the same list existing installs have. If it fails (API unreachable),
   warn the user and continue with the committed snapshot; a stale bundle is
   not a release blocker.
3. Run `./scripts/sync-safari.sh` — this is what carries the version into the
   Xcode project (`MARKETING_VERSION`) and syncs the extension resources.
   Never edit `MARKETING_VERSION` by hand.
4. Re-run `node scripts/render-listing.js --check` and `node tests/run.js`.
5. Commit everything as `Release v<version>`, tag `v<version>`, and
   `git push origin main --follow-tags`.

## Step 4 — Ship all three stores

Start Safari first (it's the ~15-minute leg), then run Chrome and Firefox
while it archives.

**Safari (macOS, local):**
1. `./scripts/submit-appstore.rb --preflight` BEFORE archiving — a doomed
   submission should fail in seconds, not after a 15-minute build.
2. `./scripts/release-safari.sh` (sync + archive + upload; run in background
   and monitor). Never auto-retry it on failure — show the output and stop.
3. `./scripts/submit-appstore.rb --release-type=<MANUAL|AFTER_APPROVAL>` —
   polls build processing, attaches the build, submits for review. If it fails
   mid-submission it has already saved the metadata; finish at the App Store
   Connect link it prints.

**Chrome (GitHub Actions):**
1. `gh workflow run cws-release.yml` then watch it
   (`gh run watch $(gh run list --workflow=cws-release.yml -L1 --json databaseId -q '.[0].databaseId')`).
   The workflow self-gates on the version change and both uploads and
   publishes (submits for review) in one run.
2. Confirm with `./scripts/cws-status.sh` — expect `submittedVersion` =
   new version and `pendingReview: true`.

**Firefox (local):**
1. `./scripts/release-firefox.sh` — stages the extension (keeping
   `background.scripts`; only the Chrome zip strips it), lints, and submits a
   listed version with the release notes attached. AMO auto-publishes after
   validation, usually within minutes; the script does not wait for approval.

## Step 5 — Report

End with a per-store summary: version, state, and where to check:
- Chrome: pending review — https://chrome.google.com/webstore/devconsole or
  `./scripts/cws-status.sh`
- Firefox: https://addons.mozilla.org/en-US/developers/addons (auto-publishes
  after validation)
- Safari: the App Store Connect link printed by `submit-appstore.rb`. With
  MANUAL release timing, remind the user to click "Release this version"
  after Apple approves.

Note that the stores approve at different speeds — versions briefly diverging
across stores is normal.

## Important rules

- Never release from a dirty tree or off `main`. Never skip the release-notes
  roll or the user's version confirmation.
- `manifest.json` is the only place the version is edited by hand;
  `sync-safari.sh` owns `MARKETING_VERSION`.
- Never pass `-authenticationKey*` flags to xcodebuild — the ASC API key lacks
  cloud-signing permission; Xcode's signed-in session handles signing.
- Never auto-retry `release-safari.sh` or re-dispatch `cws-release.yml` on
  failure without showing the user what happened first.

## First-run setup (one-time, per machine)

- **Firefox:** create an AMO API key at
  https://addons.mozilla.org/en-US/developers/addon/api/key/ and copy
  `.env.amo.example` → `.env.amo`. Before the first automated submission,
  verify the AMO listing for `knockoff@knockoff.shopping` is complete in the
  Developer Hub (categories, summary, license) — `node scripts/render-listing.js`
  prints the copy to paste.
- **Safari:** create `.env.asc` with `ASC_KEY_ID`, `ASC_ISSUER_ID`,
  `ASC_KEY_FILE` — same App Store Connect API key as keptwell (shared Sabotage
  Media team `W33JZPPPFN`); copy the values from keptwell's `.env`.
- **Chrome:** already set up — GitHub secrets uploaded via
  `scripts/upload-secrets.sh` from `.env.cws`.
