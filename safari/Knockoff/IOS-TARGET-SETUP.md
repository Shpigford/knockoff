# iOS/iPadOS Safari target

The `Knockoff iOS` app target and shared schemes now exist in
`Knockoff.xcodeproj` — added programmatically with the `xcodeproj` gem
(`.context/add-ios-target.rb`, kept for reference/regeneration) and verified by
building both platforms. The release scripts (`scripts/release-safari.sh`,
`scripts/submit-appstore.rb`) ship macOS **and** iOS.

## What's already done (in the committed project)

- **`Knockoff iOS`** app target (SwiftUI): `Knockoff iOS/KnockoffApp.swift`,
  `ContentView.swift` (enable-me screen), `Info.plist`. Bundle id
  `shopping.knockoff.Knockoff` (same record as macOS), device family `1,2`
  (iPhone + iPad), deployment target iOS 15.0, shares `Knockoff/Assets.xcassets`
  (an iOS 1024 idiom reuses the existing `mac-icon-512@2x.png`).
- **`Knockoff Extension`** appex made multiplatform:
  `SUPPORTED_PLATFORMS = iphoneos iphonesimulator macosx`, with the macOS-only
  entitlements scoped to macOS (`ENABLE_APP_SANDBOX[sdk=macosx*]` etc.) so iOS
  signing doesn't choke. Resources/handler/Info.plist reused verbatim.
- The appex is embedded into the iOS app (`PlugIns/`), and both **`Knockoff`**
  and **`Knockoff iOS`** schemes are marked **Shared**.

Verified locally: `xcodebuild -scheme "Knockoff iOS" -destination "…iOS Simulator…"`
→ **BUILD SUCCEEDED** with `Knockoff Extension.appex` embedded; the macOS
`Knockoff` scheme still builds (no regression).

Sanity-check anytime with:
```
xcodebuild -project safari/Knockoff/Knockoff.xcodeproj -list   # shows both schemes
```

## What still needs YOU (Apple account — I can't do these)

These are App Store Connect / Developer-portal actions tied to your Apple
Developer account, plus the signed upload:

1. **Developer portal:** enable the `shopping.knockoff.Knockoff` App ID for **iOS**.
2. **App Store Connect:** add the **iOS platform** to the existing app record.
3. **App Store Connect:** upload iOS screenshots — with device family `1,2`, both
   an **iPhone 6.9"** and an **iPad 13"** set are mandatory — plus the iOS
   `appStoreVersion` localizations (description / keywords / support URL are
   per-platform, separate from macOS).
4. **Local, optional but recommended:** run `Knockoff iOS` on an iPhone simulator,
   enable it under Settings → Safari → Extensions, open `amazon.com/s?k=…` and a
   product page, and confirm the badges + PDP chip render (the extension logic is
   already verified against Amazon's mobile DOM, but this closes the loop on a
   real Safari surface).

Once the App ID + ASC platform + screenshots exist, the normal `/release` flow
ships both platforms automatically (it archives, uploads, and submits macOS then
iOS).
