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

## Not verified

- **The banner itself has never been seen rendering.** Its state logic is unit-tested
  and it is mounted correctly now, but the transport has stayed up through every run.
- iOS is untouched and Mac-only. `verify:contracts` verifies 16 Convex function
  contracts by parsing the Swift structs; Swift compilation remains unverifiable here.
- `decide later` (`skip`) is defined in `src/lib/review.ts` and reachable from neither
  client, so a user cannot make that decision at all. Left as an open design question.
- No CI. Every gate in this document was run by hand.
