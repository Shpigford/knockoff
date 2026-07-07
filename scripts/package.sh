#!/usr/bin/env bash
set -euo pipefail

# Package the Knockoff extension into a zip for Chrome Web Store upload.
# Usage: ./scripts/package.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

VERSION=$(node -e "console.log(require('$ROOT_DIR/manifest.json').version)")
ZIP_NAME="knockoff-v${VERSION}.zip"
ZIP_PATH="$ROOT_DIR/$ZIP_NAME"

echo "Packaging Knockoff v${VERSION}..."

rm -f "$ZIP_PATH"

cd "$ROOT_DIR"

# Chrome uses background.service_worker and warns on the Firefox-only
# background.scripts key ("'background.scripts' requires manifest version of 2
# or lower"). Strip it from the packaged manifest so the Chrome Web Store build
# is clean. The source manifest keeps both keys for cross-browser: Firefox has
# no MV3 service worker (bug 1573659) and requires background.scripts.
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT
cp -R manifest.json src data options icons "$BUILD_DIR/"
node -e "
  const fs = require('fs');
  const p = process.argv[1];
  const m = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (m.background) delete m.background.scripts;
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n');
" "$BUILD_DIR/manifest.json"

( cd "$BUILD_DIR" && zip -r "$ZIP_PATH" manifest.json src data options icons -x "*.DS_Store" )

echo "Created $ZIP_PATH"
