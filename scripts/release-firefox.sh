#!/usr/bin/env bash
set -euo pipefail

# Submit the current version to Firefox Add-ons (AMO) on the listed channel.
# Usage: ./scripts/release-firefox.sh [--lint-only]
#
# Needs AMO_JWT_ISSUER / AMO_JWT_SECRET in .env.amo — create the key pair at
# https://addons.mozilla.org/en-US/developers/addon/api/key/
#
# Listed versions auto-publish once AMO's validation passes (usually minutes).
# The script submits and returns without waiting for approval; check
# https://addons.mozilla.org/en-US/developers/addons for the outcome.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

LINT_ONLY=false
[[ "${1:-}" == "--lint-only" ]] && LINT_ONLY=true

VERSION=$(node -e "console.log(require('$ROOT_DIR/manifest.json').version)")

# Same file set as package.sh, but the manifest ships untouched: Firefox has no
# MV3 service worker and needs background.scripts (Chrome is the browser that
# warns on that key, so only the Chrome zip strips it).
BUILD_DIR="$(mktemp -d)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR" "$WORK_DIR"' EXIT

cd "$ROOT_DIR"
cp -R manifest.json src data options onboarding icons "$BUILD_DIR/"

echo "Linting Knockoff v${VERSION} for Firefox..."
npx --yes web-ext@10 lint --source-dir "$BUILD_DIR"

if $LINT_ONLY; then
  echo "Lint OK (--lint-only, skipping submission)."
  exit 0
fi

ENV_FILE="$ROOT_DIR/.env.amo"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found. Copy .env.amo.example and fill in the AMO API key." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
: "${AMO_JWT_ISSUER:?AMO_JWT_ISSUER not set in .env.amo}"
: "${AMO_JWT_SECRET:?AMO_JWT_SECRET not set in .env.amo}"

# AMO version notes come from the canonical release-notes file. Missing notes
# are a warning, not a blocker — they can be added in the Developer Hub.
METADATA_ARGS=()
NOTES=$(node -e "
  const fs = require('fs');
  const md = fs.readFileSync('$ROOT_DIR/store-assets/release-notes.md', 'utf8');
  const sec = md.split(/^## /m).slice(1)
    .find(s => s.split('\n')[0].trim() === '$VERSION');
  if (sec) console.log(sec.split('\n').slice(1).join('\n').trim());
")
if [[ -n "$NOTES" ]]; then
  # Via env, not argv: notes start with "- " which node would parse as options.
  NOTES="$NOTES" node -e "
    const fs = require('fs');
    fs.writeFileSync('$WORK_DIR/amo-metadata.json', JSON.stringify({
      version: { release_notes: { 'en-US': process.env.NOTES } }
    }, null, 2));
  "
  METADATA_ARGS=(--amo-metadata "$WORK_DIR/amo-metadata.json")
else
  echo "Warning: no '## $VERSION' section in store-assets/release-notes.md — submitting without version notes." >&2
fi

echo "Submitting Knockoff v${VERSION} to AMO (listed channel)..."
export WEB_EXT_API_KEY="$AMO_JWT_ISSUER"
export WEB_EXT_API_SECRET="$AMO_JWT_SECRET"
npx --yes web-ext@10 sign \
  --source-dir "$BUILD_DIR" \
  --artifacts-dir "$WORK_DIR/artifacts" \
  --channel listed \
  --approval-timeout 0 \
  ${METADATA_ARGS[@]+"${METADATA_ARGS[@]}"}

echo "Submitted v${VERSION}. AMO publishes automatically after validation:"
echo "  https://addons.mozilla.org/en-US/developers/addons"
