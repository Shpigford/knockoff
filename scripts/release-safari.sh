#!/usr/bin/env bash
set -euo pipefail

# Archive the Safari app for macOS AND iOS/iPadOS and upload both to App Store
# Connect. Both are the same app record (shared bundle id
# shopping.knockoff.Knockoff), just separate platform builds.
# Usage: ./scripts/release-safari.sh
#
# Version comes from manifest.json (synced via sync-safari.sh).
# Prerequisites:
#   - Xcode signed in to the team in the project (automatic signing).
#   - Shared schemes "Knockoff" (macOS app) and "Knockoff iOS" both exist.
#   - App record exists in App Store Connect for shopping.knockoff.Knockoff
#     with both the macOS and iOS platforms enabled.
# After upload, submit each platform for review:
#   ./scripts/submit-appstore.rb --platform=MAC_OS
#   ./scripts/submit-appstore.rb --platform=IOS

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="$ROOT_DIR/safari/Knockoff"
BUILD_DIR="$PROJECT_DIR/build"

"$SCRIPT_DIR/sync-safari.sh"

VERSION=$(node -e "console.log(require('$ROOT_DIR/manifest.json').version)")
BUILD_NUMBER="$(date +%Y%m%d%H%M)"
TEAM_ID="$(awk -F' = |;' '/DEVELOPMENT_TEAM/ { gsub(/[[:space:]]/, "", $2); print $2; exit }' "$PROJECT_DIR/Knockoff.xcodeproj/project.pbxproj")"

mkdir -p "$BUILD_DIR"
echo "$BUILD_NUMBER" > "$BUILD_DIR/.last-build-number"
rm -rf "$BUILD_DIR"/Knockoff-*.xcarchive "$BUILD_DIR"/export-*

echo "Releasing Knockoff v$VERSION (build $BUILD_NUMBER, team $TEAM_ID)"

# Platform-agnostic export options — same for macOS and iOS (App Store upload).
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

# One archive + upload per platform, sharing the build number. Format:
#   label|scheme|xcodebuild destination
PLATFORMS=(
  "macOS|Knockoff|generic/platform=macOS"
  "iOS|Knockoff iOS|generic/platform=iOS"
)

for entry in "${PLATFORMS[@]}"; do
  IFS='|' read -r LABEL SCHEME DEST <<< "$entry"
  ARCHIVE="$BUILD_DIR/Knockoff-$LABEL.xcarchive"

  echo ""
  echo "== $LABEL: archiving ($SCHEME → $DEST)..."
  xcodebuild -project "$PROJECT_DIR/Knockoff.xcodeproj" \
    -scheme "$SCHEME" \
    -configuration Release \
    -destination "$DEST" \
    -archivePath "$ARCHIVE" \
    archive \
    -allowProvisioningUpdates \
    CURRENT_PROJECT_VERSION="$BUILD_NUMBER"

  echo "== $LABEL: uploading to App Store Connect..."
  xcodebuild -exportArchive \
    -archivePath "$ARCHIVE" \
    -exportOptionsPlist "$BUILD_DIR/ExportOptions.plist" \
    -exportPath "$BUILD_DIR/export-$LABEL" \
    -allowProvisioningUpdates
done

echo ""
echo "Knockoff v$VERSION (build $BUILD_NUMBER) uploaded for macOS and iOS."
echo "Next: ./scripts/submit-appstore.rb --platform=MAC_OS [--preflight] [--release-type=MANUAL|AFTER_APPROVAL]"
echo "  then: ./scripts/submit-appstore.rb --platform=IOS [--release-type=MANUAL|AFTER_APPROVAL]"
