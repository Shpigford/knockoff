#!/usr/bin/env bash
set -euo pipefail

# Sync the extension source into the Safari Xcode project's resources.
# Run after changing manifest.json, src/, data/, options/, or icons/,
# then rebuild safari/Knockoff/Knockoff.xcodeproj.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RES_DIR="$ROOT_DIR/safari/Knockoff/Knockoff Extension/Resources"

rsync -a --delete "$ROOT_DIR/src" "$ROOT_DIR/data" "$ROOT_DIR/options" "$ROOT_DIR/icons" "$RES_DIR/"
cp "$ROOT_DIR/manifest.json" "$RES_DIR/manifest.json"

# Keep the app's marketing version in step with the manifest.
VERSION=$(node -e "console.log(require('$ROOT_DIR/manifest.json').version)")
sed -i '' "s/MARKETING_VERSION = [^;]*;/MARKETING_VERSION = $VERSION;/" \
  "$ROOT_DIR/safari/Knockoff/Knockoff.xcodeproj/project.pbxproj"

echo "Synced extension into Safari project (v$VERSION)."
