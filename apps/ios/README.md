# ThinkLot native iOS

Separate SwiftUI iPhone/iPad client; shares only the existing Convex deployment with the web and React Native apps. No generated example data or API keys. iOS 17+, Swift 5.10+, ConvexMobile pinned to 0.8.1.

## Run on a Mac

1. Install Xcode and [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`).
2. From `apps/ios`, copy `Config.local.xcconfig.example` to `Config.local.xcconfig`. Set the same deployment URL used by the web app's `PUBLIC_CONVEX_URL`; preserve the `https:/$()/` syntax because xcconfig treats `//` as a comment. This URL is public configuration, never a deployment admin key.
3. Run `xcodegen generate`, then `open ThinkLot.xcodeproj`. Resolve Swift packages, select an iOS simulator, and run the ThinkLot scheme. For physical devices set your development team in Signing & Capabilities.
4. Run tests with Product → Test, or `xcodebuild -project ThinkLot.xcodeproj -scheme ThinkLot -destination 'platform=iOS Simulator,name=iPhone 16' test` (choose a simulator installed on your Mac).

## Behavior

Email/password sign-up/sign-in invokes existing `auth:signIn`; restore rotates refresh tokens stored in a deployment-scoped Keychain entry. The password is not persisted. Concurrent refreshes share one request. SDK authentication uses a custom `AuthProvider`; subscriptions use the official ConvexMobile SDK and reconnect automatically. Sign-out clears local tokens and attempts server session revocation; offline revocation cannot be guaranteed.

Ideas list/search/status/tag filters use server query arguments. Favorites and priority sorting apply to the loaded result set. The UI exposes server truncation, with search/filter guidance. Archive returns only archived ideas from the bounded include-archived response; this can still be incomplete when active ideas fill the server cap. Review displays the server's bounded queue. Native board columns, detail editing, nullable fields, scoring, favorite, lifecycle transitions, archive/restore, snooze, and task add/rename/toggle/delete all call the existing backend. Restore currently explicitly returns an archived idea to Inbox, matching the backend default; the backend does not persist pre-archive status. Delete requires confirmation.

Blank optional editor fields send explicit null. All Convex number arguments use Double (Swift Int encodes as Convex int64 and would fail `v.number()`). Missing optional scores stay unscored; turning on scoring is an explicit user action. No offline write queue: errors remain visible and edits stay open for retry. Read subscriptions can be retried after errors; foreground restore refreshes auth.

## Validation and limits

`node apps/ios/scripts/verify-contracts.mjs` checks called function names against the current backend and client configuration/source invariants from Windows. It is a static contract check, not Swift compilation or native acceptance. XCTest covers result decoding, score formula, explicit null/float encoding, URL validation, refresh serialization/rotation, and offline logout. Those tests require Apple's SDK and are **not run on this Windows host**. Swift, Xcode, iOS simulator, codesigning, live authenticated native journeys, VoiceOver and native visual acceptance remain unverified. Use real test accounts on a development deployment to verify two-user isolation, cross-client subscription updates, network reconnect, relaunch persistence, and all CRUD/review/task actions before release. Board supports native idea drag/drop onto stage columns and an accessible detail menu alternative; both need device verification. App-specific audio recording/transcription is not implemented; system keyboard dictation can enter capture text.

Implementation references checked October 8, 2026:

- [Official Convex Swift overview](https://docs.convex.dev/client/swift/overview)
- [ConvexMobile 0.8.1 implementation and auth protocol](https://github.com/get-convex/convex-swift/blob/0.8.1/Sources/ConvexMobile/ConvexMobile.swift)
- [Convex Swift encoding](https://github.com/get-convex/convex-swift/blob/0.8.1/Sources/ConvexMobile/Encoding.swift)
- [Apple Keychain guidance](https://developer.apple.com/documentation/security/using-the-keychain-to-manage-user-secrets)
