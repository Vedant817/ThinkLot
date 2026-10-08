# ThinkLot — Product Specification

> Source of truth: Notion page **"Idea Parking Lot"**
> `https://app.notion.com/p/33f047502f5880258721ea4d5b0049a8` (last edited 2026-08-07)
> Fetched into this repo so the build never depends on live Notion access.

## North star

**This is not a notes app.** It is an **Idea Lifecycle Manager + Decision System + Execution Tool**.

### Goal

Build a smart idea parking lot that helps you:

- Capture ideas quickly
- Organize them
- Score and prioritize
- Convert ideas into action
- Revisit forgotten ideas
- Collaborate (later phase)

### Idea lifecycle

```
Inbox → Parked → Reviewing → Ready → Building → Done → Archived
```

## 1. Current status

- **Phase:** Phase 1 — MVP
- **Target:** Week 1–2 deliverable (CRUD + local storage)

### Win condition

- Add idea
- Edit idea
- Persist after refresh

## 2. Inbox (capture fast, no judgment)

Drop ideas here in 30 seconds. You can make them "beautiful" later.

```
- [x] Idea (title):
- [x] One-liner:  — the title IS the one-liner; there is no separate field
- [x] Problem:
- [x] Who is it for:
- [x] Expected outcome:
- [x] Notes:
- [x] Tags:
- [x] Source / trigger:
```

> **Three of these did not exist until an audit against this document.**
> "Who is it for", "Expected outcome" and "Source / trigger" were listed here for
> the whole project and were absent from the schema, the mutations and every
> screen — while the roadmap showed all eight weeks complete. They are built now.
>
> "Source / trigger" is *not* the `source` column that did exist. That one records
> whether text arrived by voice, which answers a different question from what
> prompted the idea. The similar names are what let the gap survive.
>
> The lesson recorded here rather than left implicit: **the roadmap is checked off
> by week, which is too coarse to catch a field that was never built.** The
> per-item acceptance criteria in 5.1 are the ones that should be trusted, and they
> were left unchecked precisely because they were never verified.

## 3. Roadmap (progress tracker)

### Week 1 — Setup + CRUD foundation

- [x] Setup SvelteKit project
- [x] Add Tailwind CSS
- [~] Create base folders (`/components /lib /routes /stores /types`)
- [~] Define `Idea` type (`src/types/Idea.ts`)

> Two boxes corrected on audit. `/components`, `/lib` and `/routes` exist as
> specified. `/stores` exists but is empty — Svelte 5 runes replaced the store
> pattern this project would have used, so nothing was ever put there. `/types`
> does not exist: the `Idea` type is at `src/lib/types.ts`, alongside the scoring
> and status constants it shares a module with. Both are deliberate and neither is
> a missing feature, but a ticked box is a claim about the filesystem and this one
> was not true.
- [x] Basic list + create form
- ~~Create store (`src/stores/ideas.store.ts`)~~ — **not built, deliberately.** Convex
  owns the state; a second client-side store would duplicate it and immediately
  drift. Replaced by hand-written reactive query bindings in
  `src/lib/convex/query.svelte.ts` (Convex ships React bindings only).
- ~~LocalStorage persistence~~ — **superseded.** Ideas live in Convex with
  realtime sync, not in the browser. LocalStorage now holds only auth tokens and
  the theme, and the capture bar holds an unsaved draft there deliberately.

### Week 2 — Tagging + search + statuses

- [x] Tag input + tag list filtering
- [x] Search by title/description
- [x] Status pipeline (Inbox / Parked / Reviewing / Ready)
- [x] Card view + list view toggle

### Week 3 — Kanban board + drag & drop

- [x] Board view route
- [x] Drag between statuses
- [x] Idea details page

### Week 4 — Scoring engine + dashboard

- [x] Impact / Effort / Confidence inputs
- [x] Priority score formula: `(Impact × Confidence) / Effort`
- [x] Sort + highlight top ideas
- [x] Dashboard widgets (counts + top ideas)

### Week 5 — Review system + reminders

- [x] Review queue rules (7 days untouched, parked, high score)
- [x] Snooze / archive / promote actions
- [x] Revisit reminder logic

### Week 6 — Convert idea → action

- [x] IdeaTasks schema + checklist UI
- [x] Progress indicator per idea

### Week 7 — Backend + auth

- [x] Auth + sync

### Week 8 — Polish + deploy

- [x] Keyboard shortcuts
- [x] Dark mode
- [ ] Deploy

> **This box used to be ticked and was wrong.** Nothing has been deployed to
> production — Convex production is billed separately, and deployment is the
> owner's decision, not an implementation step. Everything below is preparation.
> A checkbox that says "done" for work that was deliberately not performed is
> worse than an empty one, because it stops anyone from asking.

> **Deploy status:** the repository is deploy-ready (multi-stage Dockerfile,
> `.env.example`, `/healthz` that returns 503 on a missing `PUBLIC_CONVEX_URL`,
> and `docs/DEPLOY.md`). **No deployment has been performed** — a Convex
> production deployment is billed separately and creating one, plus a public URL,
> is the owner's decision. See `docs/DEPLOY.md`.

## 3.1 What "done" means here, and what is still open

All eight weeks are implemented. **That statement is now qualified**, because the
first version of it was wrong.

### The audit, and what it found

Auditing every claim in this document against the code — not the checkboxes,
the claims — found **seven** places where the document asserted something the code
did not do. All are now fixed; the point of listing them is that six of the seven
were *ticked*, and a green box on a week is far too coarse to notice a field that
was never built.

| Spec claim | Reality found |
|---|---|
| §2 "Who is it for" | absent from schema, mutations and both clients |
| §2 "Expected outcome" | absent |
| §2 "Source / trigger" | absent — the existing `source` column records *dictation*, a different question |
| §6 Dashboard in main navigation | no `/dashboard` route; the landing page's "Login to dashboard" was a live 404 |
| Week 3 "Card view + list view toggle" | one layout, no toggle, and it satisfied the card half only |
| Week 8 "Deploy" | never deployed, by deliberate decision |
| Week 1 base folders + `src/types/Idea.ts` | `/stores` empty, `/types` absent, type lives in `src/lib/types.ts` |

Chasing section 6 turned up two more problems that were never spec *claims* at all,
which is the more interesting kind:

- **A filtered lot was silently thrown away by the app's own back link.** All list
  state was component-local, so opening an idea and coming back discarded the
  search, the tag filters, the sort and the view. A refresh did the same, and no
  filtered view could be shared. The review queue's reason filter and the archive's
  search had the same defect independently.
- **The dashboard shipped without a keyboard shortcut**, making it the one
  destination in the nav a keyboard user could not reach — and the page you land on
  after signing in. The shortcut suite passed throughout, because it only asserted
  the four chords that already existed. It now asserts that every destination is
  reachable, derived from the registry rather than from a hand-written list.

Everything else in this document was checked and **is** genuinely implemented:
the six statuses (a superset of the four specified), search, the board with
drag-and-drop, the scoring formula with 0–10 sliders, the three review rules with
snooze/archive/promote, checklists with a progress indicator, auth and sync,
43 keyboard shortcuts and dark mode.

The generalisable lesson, recorded here rather than left implicit: **week-level
checkboxes are not evidence.** The per-item acceptance criteria in 5.1 are closer
to evidence, and they were unchecked for most of the project only because nobody
had verified them either. And a test that asserts only what already exists will
happily confirm a new feature is unusable by everyone it was not written for.

### Verified by execution

**Verified by execution**
- Backend: `npm run verify:e2e` — 132 live checks against the dev deployment,
  including every negative authorization case. `svelte-check` clean.
- Capture/editor preservation: `scripts/verify-capture-regressions.ts`, offline.
- Keyboard shortcuts: `npm run verify:shortcuts` — 36 checks.
- React Native client: typecheck and lint clean, Expo Doctor 21/21, Android and
  iOS Hermes exports pass. Exports prove bundling, not native rendering.
- **Android on device** (API 36, 1080x2400): two release APKs built with real
  device ABIs, installed, and the signup → capture → LOT-0001 journey walked. The
  three spec fields were typed, saved, and their persistence confirmed
  independently via server-side search — a string that exists only in the `audience`
  column, not in the title or description. Verified on screen: light and dark
  palettes, 1.3x system font scale, a 360x640dp small phone. Four defects were
  found this way and fixed.
- Swift client: a static contract check over 16 backend functions. Compilation,
  simulator and device testing need Apple SDKs and are unverified on this host.

**Not verified — needs a browser or a device**
- **Any rendered web UI.** No browser has ever been attached to this session, so
  every web claim above is compiled output, HTTP responses or pure-function tests.
  The app is a client-rendered shell, so even its SSR output proves nothing about
  what is inside a conditional branch. This is the largest remaining gap and it is
  not closeable from the toolchain available here.
- The new Dashboard, the list view, and the three spec fields — as rendered pixels
  on the web. The spec fields *are* verified on Android; the web half is not.
- The entire iOS journey.
- A production deployment of any kind.
- Anything on a physical device rather than an emulator.

**Known and accepted, documented rather than hidden**
- Account enumeration. Convex Auth v1 rethrows distinguishable errors from a
  public action; three fixes were built and rejected, all recorded in
  `src/convex/auth.ts`. Closing it means owning the provider.
- Sign-in throttling is keyed on the account id, so unknown addresses are not
  throttled. Also recorded at the setting that configures it.
- List queries still scan an owner's rows before filtering and capping. Small
  fixtures prove correctness, not scalability.
- Capture drafts in the Swift client are view-memory only.

## 4. Feature specs

### 5.1 Idea model (core object)

**Fields**

- `id`, `title`, `description`, `problem`, `status`, `tags[]`
- `impact_score`, `effort_score`, `confidence_score`
- `created_at`, `updated_at`, `revisit_date`
- `archived`, `favorite`
- `audience`, `outcome`, `trigger` — the section 2 fields, added late

**Acceptance criteria (Phase 1)**

- [x] Create, edit, delete an idea
- [x] Assign tags
- [x] Set status (Parked / Reviewing / Ready)
- [x] Persist locally across refresh

> These were left unchecked for most of the project even though the roadmap said
> every week was done. They are now verified against the live deployment by
> `verify:e2e`, including the negative authorization cases. Note that "persist
> locally" is satisfied by Convex rather than browser storage — the data survives
> a refresh because it was never in the browser.

### 5.2 Views

- **List view** — scan and search quickly. Must show: title, status, tags, favorite.
- **Card view** — evaluate ideas visually. Must show: title, short description, tags, status.
- **Kanban view (Phase 2)** — move ideas through the pipeline. Must support drag and drop between statuses.

### 5.3 Scoring (Phase 3)

- Priority Score = `(Impact × Confidence) / Effort`
- Sliders or steppers for the three inputs
- Sort ideas by priority
- Highlight top ideas

### 5.4 Review system (Phase 4)

**Weekly review rules**

- Not touched in 7 days
- Parked ideas
- High score ideas

**Actions** — Snooze, Archive, Promote to Ready

### 5.5 Convert idea → action (Phase 6)

**Schema: IdeaTasks**

```
idea_id
task
completed
```

**UX** — Checklist inside idea, progress bar.

## 5. Tech stack

| Layer | Choice |
| --- | --- |
| Frontend | SvelteKit (Svelte 5 runes), TypeScript, Tailwind CSS 4 |
| State | Svelte runes / Convex reactive queries |
| Backend | **Convex** (overrides the spec's original Supabase — decided by project owner) |
| Mobile | React Native, sharing the same Convex backend |

> **Deviation from spec:** the original page specified Supabase for Week 7. The project owner
> chose Convex instead because the repo was already scaffolded on it and it provides auth,
> realtime sync, and cron in one platform.

## 6. UI + routes

**Main navigation** — Dashboard, Ideas (List / Cards), Board, Review, Archive

**Layout**

- Sidebar: nav
- Main panel: list/board
- Right panel: idea details + score + notes

> The **Dashboard did not exist** for most of the project, despite being listed
> above as the first navigation item — and the landing page already linked to it
> as "Login to dashboard", so that link was a live 404. It is built now, and signing
> in lands on it. It arrived without a keyboard shortcut while every other nav item
> had one, which `verify:shortcuts` now prevents by asserting that each destination
> is reachable.

### Two deliberate deviations from the layout above

**No right-hand details panel.** The sidebar and the main panel exist; the idea
detail page is a separate route instead of a third column beside the list. This is
the right call on a phone, where three columns have nowhere to go, and this app
ships a React Native client as a first-class target rather than an afterthought.

It is not free, though. The property a master-detail layout gives you is that you
never lose the list you were looking at — and the route-based version was losing
it. "← Back to the lot" was a plain `/ideas` link, so opening an idea and coming
back silently discarded the search, the tag filters, the sort and the view. A
refresh did the same, and no filtered view could be shared or bookmarked.

Fixed by moving all list state into the query string, shared by the lot, the review
queue and the archive (`src/lib/filters.svelte.ts`). Idea links carry the filters
and the detail page reuses its own query string for the back link. So the guarantee
the panel would have provided is provided by the URL instead.

**`Archived` is a flag, not the seventh lifecycle stage.** Section 0's lifecycle
reads `Inbox → Parked → Reviewing → Ready → Building → Done → Archived`, which
puts Archived in sequence with the six statuses. It is implemented as an orthogonal
boolean instead, so an idea can be archived from any stage and restored to the stage
it came from — the board shows six columns, and archiving does not overwrite where
an idea was. The previous stage is captured on archive and restored with it, which
is verified in `verify:e2e`.

Treating Archived as a stage would mean archiving a "ready" idea lost that fact,
and the board would gain a column of things the user has chosen to stop looking
at.

## 7. Folder structure

```
src
├ routes
│  ├ dashboard
│  ├ ideas
│  ├ review
│
├ components
│  ├ IdeaCard
│  ├ IdeaForm
│  ├ KanbanBoard
│
├ stores
│  └ ideas.store.ts
│
├ lib
│  ├ scoring.ts
│  ├ filters.ts
│  └ storage.ts
│
├ types
│  └ Idea.ts
```

> **What actually exists, and why the difference is mostly deliberate.**
>
> - `lib/scoring.ts` — as specified.
> - `lib/filters.ts` — exists as **`lib/filters.svelte.ts`**, because it uses runes
>   and those only compile in a `.svelte.ts` module. It is real shared behaviour
>   used by three routes (URL-backed list filters), not an empty placeholder.
> - `lib/storage.ts` — **does not exist.** The three things stored in the browser
>   are auth tokens, the theme, and the capture draft, each used exactly once and
>   unrelated to the others. A module wrapping three unrelated single call sites
>   would exist to match this diagram rather than to remove a duplication, and the
>   duplication it would prevent has not happened.
> - `types/Idea.ts` — does not exist; the type is `lib/types.ts`, beside the scoring
>   and status constants it shares a module with.
> - `stores/ideas.store.ts` — **not built, deliberately.** Convex owns the state; a
>   second client-side store would duplicate it and immediately drift.
> - `components/IdeaCard`, `IdeaForm`, `KanbanBoard` — not components under those
>   names. The card and board render inline in their routes and `components/` holds
>   `CaptureBar`, `TaskChecklist`, `AuthForm`, `StatusPill`, `ShortcutHelp` and
>   `QueryError`. These names are a sketch of responsibilities, not a file manifest.
>
> Recorded item by item because "the folder structure roughly matches" is the kind of
> claim that is true enough to pass review and false enough to waste an afternoon.

## 8. Backlog (future differentiators)

- AI idea summarization
- AI duplicate detection
- Idea clustering
- Idea timeline
- Idea maturity tracking
- Idea roadmap builder
- Idea export to Notion
- Idea public sharing

## 9. Deployment

`npm run build`