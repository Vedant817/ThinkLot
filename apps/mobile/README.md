# ThinkLot mobile

Expo SDK 57 / React Native client for the same Convex account and backend as the web and separate SwiftUI apps.

## Run

From `apps/mobile`:

```powershell
npm ci
Copy-Item .env.example .env.local
# Set EXPO_PUBLIC_CONVEX_URL to your development deployment URL.
npm start
```

Use Expo Go for SDK 57, or generate a native build using `npx expo run:android`. A local iOS build needs macOS and Xcode. Native directories are generated from app.json and ignored; do not edit them directly. `main` is `expo-router/entry`; routes live in src/app.

On Windows, native builds need a short **physical** checkout path, such as `C:\tl`: Ninja 1.10 rejects generated C++ object filenames over 260 characters at this repository's current path. A `subst` drive is insufficient because autolinking can mix canonical and mapped roots. Metro excludes native compiler/cache output from its crawler while retaining JavaScript package `build` directories.

## Features

Email/password signup/signin, official Convex Auth token refresh with native SecureStore, protected routes, account logout, dashboard, capture, server search/stage/favorite filters and priority sorting, ledger list, six-column board with drag/drop and explicit move controls, archive/restore, detail editing, nullable scores and text, atomic tag additions/removals, review/promote/snooze, task add/rename/toggle/delete, system light/dark theme and safe-area-aware layouts.

Text edits send only changed fields, keep unsaved values through realtime updates, and ask before navigation discards a draft. Capture drafts are stored locally per account; typing during capture remains available after the earlier request succeeds. Queries subscribe only while their screen is focused. Errors stay visible with retry; writes are not queued offline. Archive restores explicitly to Inbox because the existing backend does not store the pre-archive stage. Search/filter/sort happen before the server's 250-result cap, and truncated results are disclosed.

The backend optional list arguments `archivedOnly`, `favoriteOnly`, and `sortPriority` must be deployed before using this client. Generated API bindings must exist at the repository root: run `npx convex codegen` there when setting up a fresh checkout. This uses the same generated API/types and scoring module as web through Metro's watch folder, so no copied backend contract or independent scoring formula can drift.

## Checks

```powershell
npm run typecheck
npm run lint
npx expo-doctor
npx expo export --platform android
npx expo export --platform ios
# From repository root: offline data-preservation regressions
npx vite-node scripts/verify-capture-regressions.ts
```

See [the verification record](../../docs/MOBILE-VERIFICATION.md) for performed checks and remaining native acceptance. The board supports drag/drop between visible columns plus explicit stage moves, and the lot offers list/card views. Drag/drop was verified in the Expo web runtime; native touch behavior still needs device acceptance. System keyboard dictation can enter text; there is no app-specific microphone recording/transcription, local notifications or push integration. Backend email reminders still require a real delivery provider. No store signing, EAS cloud build or production publication was performed.
