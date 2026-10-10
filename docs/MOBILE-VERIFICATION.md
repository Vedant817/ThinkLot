# Mobile verification

Every claim below names the evidence it rests on. Where a claim could not be
supported, the gap is stated rather than smoothed over.

## Physical device runs

Two runs on a **Samsung Galaxy A22** (`SM_A226B`, Android 13 / API 33, arm64-v8a,
1080x2408 @ 450dpi = 384x768dp), over USB, with a release APK and then a debug APK
served by Metro.

Run 1 had **no usable network** on the device (`Active default network: none`,
`ping 8.8.8.8` returned `Network is unreachable`, Wi-Fi enabled, mobile data on,
airplane off). It established launch, rendering at 1080x2408, form input, and the
disabled-button behaviour; it also found the missing offline indication.

Run 2 had a live network and drove the authenticated workflow end to end. It is the
run that found the sign-in defect below.

### Sign-in on Android did not work at all

Symptom: tapping "Create account" left the button permanently disabled, with the
backend provably healthy (a live `signInProxy` signUp returns tokens in ~1.1s).

Instrumenting `submit()` and reading `logcat` gave the answer, which was not any of
the reasons being considered:

```
submit:signInProxy resolved tokens=true      (0.8s)
submit:jwt stored / refresh stored           (47ms)
submit:waitForAuth=false                     (4s later, still not authenticated)
```

`index.tsx` was writing the session itself - `AsyncStorage.setItem("__convexAuthJWT")`
- on the reasoning that those were "the same keys the library persists". Two things
are wrong with that, both verifiable in `node_modules`:

1. **Wrong store.** `tokenStorage` (`src/lib/auth.ts`) is `expo-secure-store`.
   AsyncStorage is a different, non-secure store entirely.
2. **Wrong key.** `@convex-dev/auth@0.0.96` namespaces every storage key -
   `` `${key}_${escapedNamespace}` `` in `dist/react/client.js` line 289, with the
   namespace defaulting to the deployment URL. So the bare key is never read, in
   any store.

The fix is to stop hand-writing the session: `signInProxy` authorises the credentials
(metered, error-normalising, per-address budget), then `useAuthActions().signIn`
establishes the session through the client's own storage. Both clients now do this.

### A second, worse bug was introduced trying to fix the first one

The first fix polled `isAuthenticated` with a 4s bound, reasoning that a lost race
should become a visible error. It worked: the user got a message. The message was
**wrong** - sign-up had succeeded and the app had already navigated, but the
`index` screen unmounts the moment the auth guard flips, so the effect maintaining the
ref never ran. The poll timed out against a value that had stopped being written and
told the user "Signed in, but the app did not pick it up."

Recorded because the flawed fix is not obviously worse than the original bug at the
time: it looked like better error reporting. It converted a hang into a lie. The poll
is gone; `signIn` resolving *is* the session, and rejecting is the failure.

### The offline banner was built wrong twice

Run 1 found the gap. Run 2 found the fix did nothing:

- Mounting `<ConnectionBanner/>` as a bare child of `<Stack>` produced
  `W ReactNativeJS: Unknown child element passed to Stack: function ConnectionBanner(a0)`
  in logcat, and rendered nothing.
- Recasting it as `<Stack.Screen name="connection">` would never have mounted either,
  because declaring a route does not focus it.

It is now a sibling of the navigator, absolutely positioned, outside the auth guard -
the original bug was a device with no network sitting on the *sign-in* screen, so the
banner is most needed exactly where authentication has not succeeded.

State comes from a real subscription, not a render-time read:
`connectionState()` returns a plain snapshot with no notification path, so it only
refreshes when some unrelated query happens to re-run. `subscribeToConnectionState`
is what the client publishes and is what `useSyncExternalStore` needs; the snapshot is
cached and only replaced when a flag changes, because `getSnapshot` returning a fresh
object makes React throw.

### The archive demanded a reason and then hid it

The review screen requires one sentence to let an idea go and stores it in
`letGoReason`. It was rendered in neither client. Now shown on the idea detail (both
clients) and the archive row (both clients). Server-side it rides into `toSummary`
conditionally, like `trigger`, so it costs nothing for the ideas that were never let
go.

### The board's Move control was unreachable on a phone

Column width was a hard-coded 300dp, justified as "a full column plus a deliberate
peek". On a 384dp phone, the page's own 20dp padding clips the scroll viewport to
344dp, so the second column is a 28dp sliver. A card in that sliver had its
`[Open][Move]` row laid out past the clip: the accessibility tree reported Move with
an **inverted bounds rect** (`[1068,834][1024,947]`) and no text child, the screenshot
showed only Open, and tapping its coordinates did nothing.

Columns now derive from the measured viewport (88%) and snap, so one dominant column
is always fully visible with a real peek.

Worth noting what this was NOT: the select-then-move logic, the reason gate and the
stage mutation were all correct. It was reachability, and it only reproduced at some
scroll positions - which is why it took a screenshot to diagnose.

### Mobile had the same stale export section as web

Three hand-written buttons naming only Notion, JSON and CSV, so Jira, Linear and
Obsidian were unreachable from a phone even though `$lib/export` produces all three.
Both clients now generate from `EXPORT_TARGETS`.

## Walked and verified on hardware

- sign-up and sign-in, with the session surviving a full app restart (SecureStore)
- capture, typed and dictated. `adb input text` injects the whole string in one change
  event, which the dictation heuristic cannot tell apart from Wispr Flow - so the
  toast was checked both ways, typing character by character at ~180ms.
- LOT plates monotonic, drafts surviving a tab switch, the unsaved-edit guard
- all four review decisions, including the reason gate enabling only when a reason is
  typed
- archive retention with the prior stage, and restore
- board columns, and a READY -> BUILDING stage move
- all five export targets, sharing Jira with the real import steps in the note

## Third run: the previously-unverified list, worked through

Device online, dev build over Metro except where noted. Each item below was either
verified, fixed, or is stated as still open.

### Banner: verified, and fixed again

Airplane mode over USB (adb survives it). The banner rendered: "Offline — ideas may
not save" with Dismiss. Dismiss works; disabling airplane mode cleared it on
reconnect. But its first screenshot showed the text colliding with the status bar:
as a sibling of the navigator it sits outside SafeAreaProvider's insets, so it now
takes its own via `useSafeAreaInsets`. Re-verified after the fix.

### Parked archive/restore: real bug, fixed server-side

Park 7d, archive, restore — the idea came back as `inbox`, silently discarding the
dated park, and with `revisitAt` still set the queue then suppressed it as a dated
park while its status read inbox: invisible for 7 days, then back as inbox.
`setArchived` deliberately stored nothing when the idea was already parked, treating
`parked` as scratch rather than a stage. It now remembers the actual stage
unconditionally; remembering `parked` cannot regress the stale-client-row case the
special-case was written for, because the client hint stays a fallback for legacy
rows only. Verified on device (back as `parked`, revisit date intact) and by a
targeted HTTP probe covering the old contracts too. e2e section 8 extended with the
parked case. The mobile button said "Restore to inbox" (describing the bug); it
says "Restore" like web now.

### Import: full round-trip on device

The real Jira fixture pasted line-by-line into the Account import field: "3 new",
"Read as Jira — saw issue key, issue type, resolution, story points", 13 unmapped
columns named, per-idea rows with tags, "Import 3 ideas" → "Imported 3.", all three
visible on the Lot with plates, descriptions and tags.

### Scoring: set, header, clear

Impact 8 / effort 2 / confidence 7 via the stepper buttons → header reads
`parked · priority 28.0`, maturity drops "a score" from its missing list, Home
counts update. Clearing confidence returns the header to `--`. (One blind tap in
the harness set confidence 1 on a different idea mid-run; cleared as part of the
test, and it demonstrated the steppers respond.)

### Tags, tasks, favorites

Add tag → `#neighbors` chip with Remove. Add task → "0 of 1", complete → "1 of 1"
with ✓ and "Mark unfinished". Task delete is one tap with no confirm — checked
against web, which does the same; tasks are retypeable, ideas confirm on both, so
parity holds and nothing changed. Mark favorite → "Remove favorite".

### Idea delete: native confirm verified

"Delete idea permanently" opens a native Alert ("Delete this idea? / Its tasks will
also be permanently deleted." / CANCEL / DELETE). CANCEL dismisses with nothing
deleted. (It first appeared from a harness mis-tap, which is also how we know the
destructive button is reachable — but that says nothing about layout safety, and no
layout claim is made from it.)

### Sign-out/in cycle

Sign out returns to the sign-in screen; signing back in restores the session and
all 7 ideas intact (SecureStore survives).

### Search

"handover" filters to 1 of 5 correctly. (The same run left the capture draft
holding an earlier typed sentence; saving it kept state clean.)

### Still not verified

- Board drag-and-drop (the ⠿ handle). The select-then-move flow is verified; the
  drag gesture itself has never been exercised and is hard to drive over adb.
- The cold-start splash visual. It is configured (dark paper, system-ui behind it)
  but no screenshot of the ~1s splash window was captured.
- iOS, `skip`, CI: unchanged from before.

## Size, speed, and the decremental constraint

Release APK (arm64-only): **41.9MB**, of which our entire JS bundle (Hermes
bytecode, minified) is **3.0MB — 7%**. dex is 38.8MB uncompressed, native libs
20MB: libreactnative 7MB, Hermes 2.5MB, Reanimated 1.7MB + worklets 1.3MB (both
required by expo-router's drawer — removing them means dropping the router),
expo-modules-core 1.5MB. Local data footprint is ~50KB (drafts, tokens, prefs);
the 7.3MB seen in `files/` is the dev-bundle cache, which does not exist in
release builds. Everything else lives in Convex: that is what makes the footprint
decremental rather than growing with use.

Cold start on release: activity launch ~230ms, content in ~5s (session intact),
dominated by TLS + WebSocket + first queries, not by the client. No custom fonts
are loaded anywhere and there are no blocking splash calls, so there is nothing
left on the client side to cut without the native toolchain.

What would actually shrink it, honestly: ProGuard + resource shrinking (needs
`expo-build-properties`, which cannot be installed — npm `allow-scripts` policy
blocks it — and hand-editing the generated `android/` is against the repo rules),
and dropping expo-router (a rewrite, not a tweak). The floor for an Expo app is
~25–35MB; this one at 42MB is near it, not far above it.

## Fourth run: AI on the phone, Decide later, drag, splash

### AI settings + per-idea panel, verified on hardware

`ai-credentials.ts` existed with zero importers. It is now wired: an "AI providers
& keys" route off Account (all 8 providers from the shared registry, local first;
session/device modes; masked key + Forget; model field with suggestion chips; Test
connection with a real 8-token call). Verified with a bogus OpenAI key: save masks
(`sk-b••••••••ly · saved`), Test returns "OpenAI returned 401 - the key was rejected."
with the corrective hint, Forget restores the empty state, switching providers shows
each provider's own key slot, and an app restart drops session state back to
defaults. A real success call was never made - no key, no spend - so the happy path
is unit-asserted, not device-proven.

The idea detail has Summarise plus the duplicates check against the server
shortlist, with the shortlist visible. Unconfigured shows "Needs a provider and
key. Set one up" up front (the first version only discovered it on press) and the
link deep-links to settings. With the bogus key, Summarise renders the 401
sentence inline. Per-provider key namespacing, session expiry on restart, and the
secure (non-echoing) key field were all observed, not assumed.

### Web was dropping every model answer

`AiAction.svelte` awaited `callModel` and discarded the result: pressing Summarise
spent money and showed nothing, and the suite passed anyway because it only
asserted preconditions. Both clients now take a required `parseResult` and render
the parsed answer (or report unusable output as a failure, not silence). The idea
page formats duplicate pairs against the shortlist with the same id-allowlist the
parser enforces.

### Decide later exists on both clients

`skip` was server-ready (event-only effect) but unreachable. Both review screens
have the button; since the server deliberately changes nothing, the row hides for
the session and returns next time. Verified on device: "3 shown of 4 · 1 left for
later", and History records "left for later · today". Same parked special-case as
the archive fix lived in the letGo `keep` substitution; removed for the same
reason, deployed to dev.

### Board drag works

Two synthetic drags appeared to do nothing; instrumented tracing showed grant +
drop reaching JS, and the drop point (320dp) landing 19dp short of the parked
column - the mechanism was fine, the test's aim was not. A further drag moved
LOT-0007 inbox → parked on device. Tracing removed afterwards. Side observation:
same-stage drops (from the missed attempts) write "Moved from inbox to inbox"
history events - `setStatus` records even a no-op. Noted, not changed.

### Splash, captured

Cold-start screenshot shows the dark slate surface, no white flash. Caveat found
while at it: top-level `splash` in app.json is inert in SDK 57 (generated
`#FFFFFF`) - it has to live in `expo-splash-screen` plugin props, which now emit
`#171920`. Also: `C:\tl` builds never re-run prebuild, so no app.json plugin
change ever took effect in any build until a manual prebuild was run; the final
release below is the first build with the real splash config.

## Fifth run: analytics for users and owner

Three PM agents scoped it (user lens, owner lens, data/privacy/cost lens); the
synthesis overruled them twice, both stated here:

1. The data architect wanted analytics writes piggybacked onto every mutation
(+1R+1W per action). Rejected: it taxes the hot path and risks latency for data
a cron can derive. The rollup reads existing tables + one heartbeat table.
2. The data architect wanted aggregates exposed only via internal functions +
server routes. Rejected as over-mechanism: an authenticated env-gated query
returning precomputed rows is neither unauthenticated nor a scan. The threat
model (public queries are unauthenticated HTTP) does not apply to it.

### User analytics (no new writes)

Shared `src/lib/analytics.ts` folds list rows (+ bounded own-events on web) into
streak, voice share, scoring coverage, oldest untouched, decision latency median,
30d decision mix (parsed from the exact `effectOf` narratives), let-go weeks,
park-to-build, finish-vs-letgo, verbatim-kept, favorites-acted-on, and task
follow-through. Mobile Account shows four rows; web has settings/analytics with
sections, truncation honesty (250-row cap), and the telemetry opt-out. Task
completion dates do not exist in the schema, so weekly completion metrics were
cut rather than guessed.

### Owner dashboard (one row/day)

`dailyOwnerStats` + `clientHeartbeats` (platform enum, AI boolean, day - nothing
else) + opt-out table + 08:00 UTC rollup + env-gated `owner:stats` + hidden
`/owner` route with <5-DAU percentage suppression. First rollup attempt read
~31k documents and timed out: per-metric re-scans. Rewritten as a single
collection pass (4 bounded reads/user, everything folded in memory); Oct 9
rolled up reconciled (`verified:true`, 176 DAU test bloat). Cron-derived metrics
need no client changes; heartbeat covers opens/platform/AI-setup. Provider and
model ids deferred (opt-in tier, unbuilt). OWNER_EMAIL unset until the owner
supplies their login email - the page fails closed until then.

### Verified accuracy

- `verify-analytics.ts`: exact hand-computed fixtures (streaks incl. gaps/lapses,
voice windows, latency median, narrative mapping, conversions) + source
assertions (bounded reads, gating, no content in telemetry, opt-out honored).
Two of its failures were test bugs (unpadded ISO day, miscounted parked fixture)
- stated because a suite that never catches its author is decorative.
- Live: probe account with known history reproduces exactly through
`verify-analytics-live.ts`; heartbeat/opt-out/gate/input-validation via HTTP;
rollup reconciliation flag; verify-web 99/99 including analytics route,
locked-owner route, and Decide-later presence.
- Device: Your-numbers rows match hand counts; opt-out toggles both ways;
heartbeat guard key present in AsyncStorage (written only after a successful
mutation), and today's rollup includes it.

## Owner gate: positive path proven, bloat quantified

The lock was proven; the open side was not (it needs the owner's session). Proved
it without touching theirs: OWNER_EMAIL pointed at a throwaway probe account for one
minute, owner:stats returned the 2 daily rows (all 36 metric keys, no PII in any
key), then the variable was restored to the owner's address and the probe refused
again. Temporary elevation, verified both directions, nothing left behind.

Same probe gave the bloat numbers, now on the /owner page as an overview strip
(gated, counts only): **596 accounts (590 @example.com fixtures, 6 other), 3269
ideas, 4770 events, uncapped.** The 6 non-example accounts were counted, not
inspected - whose they are was not opened. Deletion is staged, not done: it	ouches the auth tables and stays unasked-for until approved.

OWNER_EMAIL is set to the owner's address on dev. Web suite 99/99 (one transient
stall on re-run review, green on retry - stated as flake, not hidden).

## Sixth run: settings home, custom themes, type size

### Settings + integrations (both clients)

Web has `/settings` home: Profile (email + sign out), section links, and an
Integrations section showing live AI-key state per provider with Manage links.
Mobile Account restructured the same way: Profile with sign-out moved up beside
the email, Integrations with keychain-fresh status (useFocusEffect, never
cached), Appearance link. Sidebar gained a Settings entry; existing entries kept.

### Themes as data (`src/lib/theme.ts`)

One 21-token definition for both modes, DEFAULT_THEME as single source of truth
(web css-var names and mobile palette names both map from it). Builder on web
(21 tokens × light/dark via native color inputs, grouped, live contrast notes)
and phone (6 accents/surfaces per mode via swatches + hex, stated limit).
Import/export is the same JSON both directions - a phone-built theme opens on
the browser whole. Contrast notes are advisory, never a save-block. Two bugs
found while building: the store defaulted to light while boot defaulted to
system (dark-OS fresh users flashed then overrode - both say system now), and
top-level `splash` in app.json is inert in SDK 57 (moved to plugin props).

### Type size

Web root font-size (90/100/115/130%) persisted; phone multiplier through
`useFontMult()` in every primitive plus all 16 inline sizes across 7 files.
XL verified on device: wraps, never breaks (tab labels truncate at 1.3x -
stated, accepted).

### Verified

- verify-web 114/114: settings home, appearance render, dark persist, font
persist, import preview/keep/activate/delete with cleanup, Decide-later
presence. Two harness-environment traps hit and fixed: adapter-node needs env
passed explicitly (suite was testing a dead server), and Svelte re-renders
between programmatic fill and click (sleeps are load-bearing, commented).
- Device: account restructure, appearance render, light switch instant,
custom theme built/saved/active repainting the app, XL wrapping, all four
choices persisted in AsyncStorage and applied on cold boot, import refusal
renders. Mobile import *success* path not driven (device input drops JSON
punctuation) - same parser unit-tested, same wiring as transfer import,
web e2e covers the UX.
- Gates: svelte-check 0/0, mobile tsc 0, lint 0, offline suite green, parity
33/33, theme gate extended (DEFAULT three-way agreement, import round-trips,
refusals, font math).

## Not verified

- iOS is untouched


 and Mac-only. `verify:contracts` verifies 16 Convex function
  contracts by parsing the Swift structs; Swift compilation remains unverifiable here.
- `decide later` (`skip`) is defined in `src/lib/review.ts` and reachable from neither
  client, so a user cannot make that decision at all. Left as an open design question.
- **AI on mobile is missing, not just unverified.** `ai-credentials.ts`
  (SecureStore-backed key storage) exists but nothing imports it: no provider picker,
  no AI settings screen, no per-idea AI action. The shared core (`providers`,
  `adapters`, `client`, `prompts`) is pure TS + `fetch` with no DOM dependency —
  only web `credentials.ts` touches localStorage — so the gap is UI, not plumbing.
  Scoped as the next build: an Account-section settings screen reusing `PROVIDERS` +
  `validateConfig` + `callModel` against `ai-credentials.ts`, and a per-idea action
  reusing `summariseMessages`/`duplicateMessages`. Nothing was built this run; the
  run was verification, and building it mid-flight would have invalidated the
  release measurements.
- No CI. Every gate in this document was run by hand.