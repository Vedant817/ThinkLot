# Mobile verification — October 8, 2026

## Implemented clients

React Native / Expo SDK 57 in apps/mobile and a separate SwiftUI / ConvexMobile 0.8.1 app in apps/ios. Both use the existing real Convex API; neither seeds runtime sample ideas. Changes are committed by feature. The backend optional archive/favorite/priority filters were deployed to the existing personal development deployment. No production deployment or app-store submission occurred.

## Current evidence

- Web: svelte-check 0 errors/warnings; production build passes; shortcut suite 36/36. Real browser regressions confirm long capture preservation, unsaved notes surviving a live score mutation, login waiting for authenticated state, safe destination handling and original query/hash preservation.
- React Native: typecheck/lint pass; Expo Doctor 21/21; Android and iOS Hermes exports pass; web export passes. Exports validate bundling, not native rendering or signing.
- Expo web runtime: one existing QA account, one idea and one task exercised capture, text save/clear, score set/clear, tags, review/promote, archive/restore, task add/complete/rename/delete, unsaved navigation confirmation and idea deletion. Cleanup verified dashboard at zero ideas. Offline actual-component repro confirms title-only saves preserve newer remote notes/problem fields. Screenshots are kept in the system temp directory.
- Swift: static contract check passes 16 existing functions and selected configuration/encoding invariants. XCTest sources exist but require Apple SDKs. Native compilation, tests, simulator, device and VoiceOver acceptance are unverified on this Windows host.
- Database usage: reused one QA account, tiny sequential fixtures, cleaned ideas/tasks and no full live stress suite. Convex still reports account-level Free plan usage above limits; this run has not demonstrated that account usage is below limits. Screen subscriptions are released on blur; search is debounced.

## Pending acceptance and known gaps

Android installed-app journey is being investigated; Expo Go's first launch could not download from an IPv6-only localhost server, then received the bundle after changing the server binding. Its screen remained blank. This is not a passing device check. A local native Android build is attempted separately; record its final result before release.

iOS testing requires macOS/Xcode; neither platform's store signing/publication was performed. Swift drafts remain view-memory only. The React Native board has six columns, drag/drop between visible columns and explicit accessible move controls; list/card toggle is implemented. Mouse drag/drop, cross-screen freshness and rejected-save draft preservation were verified in Expo web. App-specific voice capture is absent. System keyboard dictation is available. Reminder delivery and optional Notion/AI/backlog integrations are not implemented here. Concurrent writes to the same edited field still follow server last-write behavior. Existing list queries still scan an owner's rows before filtering/capping: do not infer large-account scalability from these small fixtures.

Full production, physical-device, long-lived refresh, accessibility and offline/reconnect journeys remain acceptance work; the checks above support only the specific behaviors observed.
