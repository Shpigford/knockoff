#!/usr/bin/env bash
set -euo pipefail

# Archive the Safari app (macOS) and upload it to App Store Connect.
# Usage: ./scripts/release-safari.sh
#
# Version comes from manifest.json (synced via sync-safari.sh).
# Prerequisites:
#   - Xcode signed in to the team in the project (automatic signing).
#   - App record exists in App Store Connect for shopping.knockoff.Knockoff.
# After upload, submit for review with: ./scripts/submit-appstore.rb

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="$ROOT_DIR/safari/Knockoff"
BUILD_DIR="$PROJECT_DIR/build"

"$SCRIPT_DIR/sync-safari.sh"

VERSION=$(node -e "console.log(require('$ROOT_DIR/manifest.json').version)")
BUILD_NUMBER="$(date +%Y%m%d%H%M)"
TEAM_ID="$(awk -F' = |;' '/DEVELOPMENT_TEAM/ { gsub(/[[:space:]]/, "", $2); print $2; exit }' "$PROJECT_DIR/Knockoff.xcodeproj/project.pbxproj")"
ARCHIVE="$BUILD_DIR/Knockoff.xcarchive"

mkdir -p "$BUILD_DIR"
echo "$BUILD_NUMBER" > "$BUILD_DIR/.last-build-number"
rm -rf "$ARCHIVE" "$BUILD_DIR/export"

echo "Releasing Knockoff v$VERSION (build $BUILD_NUMBER, team $TEAM_ID)"

echo "Archiving..."
xcodebuild -project "$PROJECT_DIR/Knockoff.xcodeproj" \
  -scheme "Knockoff" \
  -configuration Release \
  -destination "generic/platform=macOS" \
  -archivePath "$ARCHIVE" \
  archive \
  -allowProvisioningUpdates \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER"

cat > "$BUILD_DIR/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store-connect</string>
    <key>destination</key>
    <string>upload</string>
    <key>signingStyle</key>
    <string>automatic</string>
    <key>teamID</key>
    <string>$TEAM_ID</string>
</dict>
</plist>
EOF

echo "Uploading to App Store Connect..."
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$BUILD_DIR/ExportOptions.plist" \
  -exportPath "$BUILD_DIR/export" \
  -allowProvisioningUpdates

echo ""
echo "Knockoff v$VERSION (build $BUILD_NUMBER) uploaded."
echo "Next: ./scripts/submit-appstore.rb [--preflight] [--release-type=MANUAL|AFTER_APPROVAL]"
