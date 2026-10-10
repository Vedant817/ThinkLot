# To-do

Everything not yet done, ordered, with why it is ordered that way. One line of
status per item and the commit that closed it, so this file is evidence rather than
a wish list.

**Rule for this file:** an item is only `[x]` when something executes it. Not when
it typechecks, not when the build passes, not when a test asserts it should work.

Legend: `[x]` done · `[~]` partly done, residual named · `[ ]` not started

---

## 1. Spec gaps (section 2, 3, 5, 6 of THINKLOT-SPEC.md)

Nine claims in the spec were false at some point. All closed.

- [x] "Who is it for" (`audience`) — `6a9d867`, verified on device and in Chrome
- [x] "Expected outcome" (`outcome`) — `6a9d867`, verified on device and in Chrome
- [x] "Source / trigger" (`trigger`) — `6a9d867`, verified on device and in Chrome
- [x] `/dashboard` route, and the landing page's dead link to it — `6a9d867`
- [x] List view + card/list toggle — `2c385f3`
- [x] "Deploy" box unticked (never deployed, by decision) — spec corrected
- [x] Base folders / `src/types/Idea.ts` documented as deviation — spec corrected
- [x] Archived-as-a-flag and the absent right panel documented as deviations
- [x] `g then d` for the dashboard, and a check that every destination is reachable — `57be576`

## 2. Accepted risks (were in §3.1 of the spec)

- [x] Sign-in throttling keyed on the account id, so unknown addresses were
      unmetered and password spraying was free — `660a7fd`, `24` checks
- [~] Account enumeration — **closed on the app's sign-in path**, measured. The
      library's `auth:signIn` stays public and still answers `InvalidSecret` /
      `InvalidAccountId`. `verify:authproxy` asserts both halves so the residual
      cannot be forgotten. Closing it needs Convex Auth v2 or owning the provider;
      owning it is blocked on the library's internal JWT signing.
- [~] List queries scanned every row — **closed where indexable** (`2acced2`).
      Free text, tags and favourites still read the candidate set, because they
      cannot be indexed and an exact `total` needs the read.
- [x] Long-lived sessions: a stale access token produced a permanently blank app
      because the refresh called the Convex client from inside the client's own
      token fetch — `54df88f`, verified in Chrome
- [x] Multi-client editing: an open idea page never saw another client's edits —
      `54df88f`, two real tabs

## 3. Backlog (spec section 8 — "future differentiators")

Ordered so that everything with **no external dependency ships first**. An item
that needs an API key, a per-call budget, or a security decision is not blocked
behind the ones that do not.

- [x] **Idea maturity tracking** — `src/lib/maturity.ts`. Derived, never stored, so
      it cannot disagree with the fields it came from. Five stages (spark, shaped,
      judged, actioned, committed) plus the single most useful next step. On the idea
      detail page and beside the score on the dashboard. Verified by
      `verify:maturity` and, rendered, by `verify:web`.
- [x] **Idea timeline** — the data already existed and nothing read it. `ideaEvents`
      has been written on every capture, stage move, archive and snooze since
      before this feature existed; the only reader was the delete cascade. Served
      from `ideas:get` so it costs no second subscription, capped at 50, newest
      first, with wording shared in `src/lib/timeline.ts`. Also added the one
      milestone nothing recorded: becoming judged.
- [x] **Idea clustering** — `src/lib/clustering.ts`, computed server-side so the
      detail page gets five rows instead of the whole lot. A tag only forms a
      cluster if it is INFORMATIVE: shared by a minority. `#work` on 80% of a lot is
      the rule, not a signal, and the naive "shares any tag" version chains an entire
      backlog into one useless cluster.
- [x] **Idea roadmap builder** - `src/lib/roadmap.ts`. FOUR lanes, not three: `now` is
      capacity-limited, and an idea that cannot be ranked or acted on goes to `unready`
      and says what it is missing, instead of padding `later`. Work already started is
      never displaced by a higher score, and overflow is reported rather than hidden.
      See `docs/DECISIONS.md` for the four architecture decisions.
- [x] **Idea export** — `src/lib/portability.ts`. Markdown that pastes into Notion,
      CSV, and a versioned lossless JSON backup. Re-import is duplicate-checked and
      *reported*, never auto-resolved. Round-trip verified offline and live (e2e
      183 → 215). Also the Notion entry point for the sharing feature below.
- [x] **Android: AI provider settings** — `apps/mobile/…/settings/ai.tsx` +
      `lib/ai-credentials.ts`. BYOK across all eight providers on a real keychain
      (`expo-secure-store`, already a dependency), session-or-persistent exactly like
      the web client, and the same `callModel` adapter — no second implementation.
- [ ] **Public sharing** — an explicit, revocable, per-idea share link. Needs a
      decision: read-only public pages leak the account's content, so it must be
      opt-in per idea and revocable.
- [x] **AI summarisation / duplicate detection** - `src/lib/ai/`, BYOK and entirely in
      the browser, so this project spends nothing and no idea text touches a server we
      run. Eight providers across three API shapes (OpenAI-compatible covers most;
      Anthropic and Gemini native), plus local runtimes that are genuinely free.
      Prompt builders in `prompts.ts` treat model output as UNTRUSTED input: fenced and
      prose-wrapped JSON is parsed out, invented duplicate ids are refused, and markup in
      a "reason" is stripped. CORS is measured per provider in `docs/AI-PROVIDERS.md`.
- [x] **AI summarisation / duplicate detection** - `src/lib/ai/`, BYOK and entirely in
      the browser, so this project spends nothing and no idea text touches a server we
      run. Eight providers across three API shapes (OpenAI-compatible covers most;
      Anthropic and Gemini native), plus local runtimes that are genuinely free.
      Prompt builders in `prompts.ts` treat model output as UNTRUSTED input: fenced and
      prose-wrapped JSON is parsed out, invented duplicate ids are refused, and markup in
      a "reason" is stripped. CORS is measured per provider in `docs/AI-PROVIDERS.md`.
- [ ] **Physical device** — all mobile evidence is an emulator. No real thumb, real
      battery, or OEM background behaviour.
- [ ] **Production deployment** — prepared, deliberately not performed. Convex
      production is billed separately and the call is the owner's.
- [ ] **In-app offline banner** — CDP's offline emulation blocks new requests but
      leaves an established WebSocket open, so the app cannot be made to notice.
      Everything around it is covered; the banner itself is not.
- [ ] **Load / scale testing** — every fixture in this repo is tiny. Correctness at
      250 rows is proven; behaviour at 50,000 is not.

## 5. Known debt, deliberately

- [~] `verify-e2e.ps1` and `verify-concurrency.ts` create a throwaway account per
      run and never clean up. Cheap, but it grows the `users` table.
- [~] The offline suites duplicate some logic the components also contain, because
      a `.svelte` file's script cannot be imported. Kept in sync by hand.
- [ ] No CI. Everything here has been run by hand, by one machine, which is the
      weakest link in every claim on this page.

---

## Mobile

- [x] **Contract drift guard** (`npm run verify:parity`) - `scripts/verify-mobile-parity.ts`.
      The iOS contract suite checked that every Convex function Swift NAMES still
      exists, and that every argument it SENDS still exists. It said nothing about the
      RESPONSE, so a required field dropped from `toSummary` would have kept every
      contract green while the iOS app failed to decode anything - and the failure would
      have looked like an auth problem. Now every non-optional `Decodable` field is
      checked against the live deployment, plus the shared `Idea` type, because the
      Android client has no type of its own and so cannot catch drift with `tsc`.
- [x] **Android parity: maturity, related, history** - all three were already crossing
      the wire from `ideas:get` and were read by nothing but the web client. The lot card
      now shows maturity, computed from the `coreFields` COUNT rather than the three
      free-text fields a list row omits - the exact bug the web client had.
- [ ] **List rows carry checklist counts** — QA finding, NOT yet done. `ideas:list`
      summaries omit task counts, so `maturityOf` inside the roadmap sees every idea as
      `judged` and the roadmap loses its "never displace work already started" rule
      silently. Needs a bounded second read (`by_user_idea`, grouped in memory — the
      `ideaTasks` index leads with `ideaId`, so a set of ideas would be N queries), and
      the cap being reached must be REPORTED, not silently produce counts that are too
      low. Started twice and reverted both times: the perturbation to the list hot path
      is not worth shipping unverified, and the edit-tool splicing corrupted
      `ideas.ts` twice.
- [x] **PM tool import** (product-manager persona) — `src/lib/pm-import.ts`, shared by
      web AND mobile. Column-alias driven, so it survives Jira's ~200-column export;
      every unmapped column is reported in its original casing rather than dropped.
      Verified offline (`verify:pm-import`) AND by driving a real Jira CSV through the
      web file input (checks 86-93).
- [ ] **PM tool export** — the same persona wants ideas back OUT into the tools they
      already use: a Notion-ready Markdown export exists, but a Jira/Linear-shaped CSV
      with Summary / Status / Labels columns would let them push selected ideas into
      a backlog ticket. Nothing built.
- [ ] **Android: AI provider settings** - the web client has bring-your-own-key across
      eight providers. Not yet on mobile. Needs a keychain, not `sessionStorage`.
- [ ] **iOS: spec fields `audience` / `outcome` / `trigger`** - `apps/ios/Sources/Models.swift`
      has no `audience`, `outcome` or `trigger`, so the iOS detail screen cannot show three
      of the six Inbox fields the spec asks for. Cannot be compiled on this host.
