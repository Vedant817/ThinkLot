# Mobile verification — October 8, 2026

## Implemented clients

React Native / Expo SDK 57 in apps/mobile and a separate SwiftUI / ConvexMobile 0.8.1 app in apps/ios. Both use the existing real Convex API; neither seeds runtime sample ideas. Changes are committed by feature. The backend optional archive/favorite/priority filters were deployed to the existing personal development deployment. No production deployment or app-store submission occurred.

## Current evidence

- Backend: `npm run verify:e2e` — **132 live checks** against the dev deployment, including every negative authorization case and the stats-reconciliation invariants behind the dashboard counts.
- Web: svelte-check 0 errors/warnings; production build passes; shortcut suite 36/36. Pure-function and HTTP-level checks confirm long capture preservation, safe destination handling, and that every app route serves 200. **No browser has ever been attached to this session, so no rendered web UI has been verified** — that is the largest gap on this project and it is not closeable from this toolchain.
- React Native: typecheck/lint pass; Expo Doctor 21/21; Android and iOS Hermes exports pass; web export passes. Exports validate bundling, not native rendering or signing.
- Expo web runtime: one existing QA account, one idea and one task exercised capture, text save/clear, score set/clear, tags, review/promote, archive/restore, task add/complete/rename/delete, unsaved navigation confirmation and idea deletion. Cleanup verified dashboard at zero ideas. The editor-preservation logic is now pinned by `scripts/verify-capture-regressions.ts`, which runs offline and free.
- **Spec-field parity**: the idea detail screen in this client edits "who is it for", "expected outcome" and "source / trigger", with the same omit/null/value contract as every other field. Writing those checks is what exposed the `reconcile` aliasing bug described in the git history — `values` and `baseline` were the same object, so mutating one moved the other and a realtime update silently discarded in-progress text.
- Swift: static contract check passes 16 existing functions and selected configuration/encoding invariants. XCTest sources exist but require Apple SDKs. Native compilation, tests, simulator, device and VoiceOver acceptance are unverified on this Windows host.
- Database usage: reused one QA account, tiny sequential fixtures, cleaned ideas/tasks and no full live stress suite. Convex still reports account-level Free plan usage above limits; this run has not demonstrated that account usage is below limits. Screen subscriptions are released on blur; search is debounced.

## Android on a real device — done, and it changed the code

The Expo Go attempt recorded below was abandoned: its screen stayed blank and no
amount of server rebinding changed that, so it was never a passing device check.
What followed was a **local native release build**, which is a different and
stronger thing.

- Release APK built with real device ABIs — `armeabi-v7a`, `arm64-v8a`, `x86_64`.
  A debug or dev-bundle APK would not have exercised the production JS path.
- Installed on an Android 15 / API 36 emulator at 1080x2400 and walked by hand:
  sign up → capture → LOT-0001 → every tab.
- Checked on screen: light and dark palettes, 1.3x system font scale, and a
  360x640dp small phone.

**Four defects that only a device could show**, all found this way and fixed:

1. The first chip in the filter strip was clipped at the screen edge.
2. The title rendered underneath the tab bar — fixed by raising the bottom
   padding from 30 to 100, the value being a guess until it was looked at.
3. A card border drawn around an invisible surface: `#f6f6f4` text on a `#ffffff`
   background, i.e. a border with nothing behind it.
4. The palette had drifted from the web tokens, so the two clients were not
   actually the same design.

**Caveats that remain true.** An emulator is not a physical device: no real
touch target under a thumb, no OEM battery or background-process behaviour, and
screen recording and animations are unreliable on this harness instance.

## Second release build — the spec fields, verified on device

Rebuilt (14m29s, three real ABIs) and reinstalled to check the three spec fields
that were added to the idea detail screen — *who is it for*, *expected outcome*,
*source / trigger* — which had previously only been typechecked.

Walked on screen, at 1080x2400:

1. Launch with a session restored from an earlier run — the Home tab rendered with
   the persisted idea, violet primary action, Feather tab icons and a violet active
   tab.
2. Lot → LOT-0001 → detail. All three fields present and correctly labelled.
3. Typed `field engineers` into *who is it for* and `a staff meeting` into *source
   / trigger*. The Save button went violet and the note changed to "Text edits are
   waiting to be saved" — the dirty state is real, not cosmetic.
4. Saved. The note reverted to "Text saved" and the button greyed out.
5. **Persistence checked independently of the editor.** Searched `field engineers`
   in the lot search box and LOT-0001 came back. That string appears nowhere in the
   idea's title or description — it exists only in the `audience` column — so the
   value is in Convex and the search genuinely covers the new field. Verifying via
   the same screen that wrote it would only have proved the optimistic state.

The three device-found fixes from the first build are confirmed on screen in this
build: the filter strip's first chip is fully visible, and the list heading clears
the tab bar.

**Not covered by this walk:** iOS, VoiceOver, tablet and foldable widths, rotation
mid-edit, and the two-client race that the `reconcile` aliasing fix addresses —
that needs a second client writing to the same idea, which one emulator cannot do.
The fix is covered by `scripts/verify-capture-regressions.ts` instead, which is
what found it.

## Pending acceptance and known gaps

The Expo Go path could not download from an IPv6-only localhost server, then
received the bundle after changing the server binding, and its screen remained
blank throughout. That path is dead; do not spend time on it. Use the native
release APK.

iOS testing requires macOS/Xcode; neither platform's store signing/publication was performed. Swift drafts remain view-memory only. The React Native board has six columns, drag/drop between visible columns and explicit accessible move controls; list/card toggle is implemented. Mouse drag/drop, cross-screen freshness and rejected-save draft preservation were verified in Expo web. App-specific voice capture is absent. System keyboard dictation is available. Reminder delivery and optional Notion/AI/backlog integrations are not implemented here. Concurrent writes to the same edited field still follow server last-write behavior. Existing list queries still scan an owner's rows before filtering/capping: do not infer large-account scalability from these small fixtures.

Full production, physical-device, long-lived refresh, accessibility and offline/reconnect journeys remain acceptance work; the checks above support only the specific behaviors observed.

---

## Reproducing the Android build

The build has three traps that all fail in misleading ways.

**1. Long paths.** Ninja rejects source paths over 260 characters, and this
repository's path is long enough to cross that line during a native build. Copy
the app to a short root first:

```powershell
robocopy <repo>\apps\mobile C:\tl\apps\mobile /MIR /NFL /NDL /NJH /NJS /NP
robocopy <repo>\src            C:\tl\src            /MIR /NFL /NDL /NJH /NJS /NP
robocopy <repo>\node_modules   C:\tl\node_modules   /MIR /NFL /NDL /NJH /NJS /NP
```

The app imports `../../../../src/convex/_generated`, so `src/` has to come
along; it is generated by `npx convex dev --once`, which pushes the functions
*and* regenerates the API. `npx convex codegen` does not push.

**2. Stale native build caches defeat the whole point of `C:\tl`.** *(added after a
build failed here, 8m38s in.)*

`robocopy /MIR` copies **everything**, and `apps\mobile/node_modules` contains `.cxx`
directories from previous builds. Those embed the **absolute path they were configured
at** — so copying them into `C:\tl` ships CMake caches pointing back at the long repo
path, and Ninja is back to compiling over 260 characters despite the short root.

The failure is misleading because it is not obviously about paths:

```
Execution failed for task ':expo-modules-core:buildCMakeRelWithDebInfo[armeabi-v7a]'.
```

Six `.cxx` directories across five native modules were involved
(`expo-modules-core`, `react-native-gesture-handler`, `react-native-reanimated`,
`react-native-screens`, `react-native-worklets`), and the tell was inside the cached
`CMakeOutput.log`, whose compile lines still referenced
`Documents/Resources/ThinkLot/apps/mobile/...`.

**Purge build output after copying, and in the source tree too** — otherwise the next
copy re-imports them:

```powershell
# after the robocopy lines above
Get-ChildItem -Recurse -Path C:\tl -Directory -Force -Filter .cxx |
  Remove-Item -Recurse -Force
Get-ChildItem -Recurse -Path C:\tl\apps\mobile -Directory -Filter build |
  Where-Object { $_.FullName -match 'node_modules\\[^\\]+\\android\\build$' } |
  Remove-Item -Recurse -Force
Remove-Item C:\tl\apps\mobile\android\app\build -Recurse -Force -ErrorAction SilentlyContinue
```

Run the same purge against `<repo>\apps\mobile`. These are gitignored build output with
zero tracked files beneath them, so this deletes nothing that belongs to the repository.

**3. A dev bundle that looks like a release.** `NODE_ENV` must be `production`,
and it must be set in the same shell that launches Gradle:

```powershell
cd C:\tl\apps\mobile\android
$env:NODE_ENV="production"
& "C:\tl\apps\mobile\android\gradlew.bat" assembleRelease `
  "-PreactNativeArchitectures=armeabi-v7a,arm64-v8a,x86_64" --no-daemon
```

Two separate mistakes live here:

- The architecture list **must be quoted**. Unquoted, PowerShell parses the commas
  as an argument separator and fails with `Missing argument in parameter list`.
- `gradlew.bat` **must be invoked by absolute path**, not as `cmd /c gradlew.bat`
  and not via `workdir` alone. The relative invocation fails.
- Omitting `NODE_ENV` still produces an installable APK, but it contains a
  **development** JS bundle. It runs, so nothing tells you it is wrong.

Output: `C:\tl\apps\mobile\android\app\build\outputs\apk\release\app-release.apk`

## Emulator notes

```powershell
adb -s emulator-5554 install -r <apk>
adb -s emulator-5554 shell wm size          # 1080x2400
adb -s emulator-5554 exec-out screencap -p > shot.png
```

**The emulator must be started with `-gpu host`** or `screencap` returns a solid
black image. That looks exactly like a blank screen and cost real time before it
was identified as a capture problem rather than an app problem.

The harness instance also throws system-level ANRs under some loads. Those are
the emulator's, not the app's — confirm by pulling up the UI hierarchy instead of
concluding the app is wedged.

Useful for responsive checks: `settings put system font_scale <n>` for font
scaling, `wm size` / `wm density` for viewport changes, and
`cmd uimode night yes|no` for dark mode.
