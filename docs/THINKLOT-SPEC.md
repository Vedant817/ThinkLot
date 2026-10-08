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
- [ ] Idea:
  - One-liner:
  - Problem:
  - Who is it for:
  - Expected outcome:
  - Notes:
  - Tags:
  - Source / trigger:
```

## 3. Roadmap (progress tracker)

### Week 1 — Setup + CRUD foundation

- [x] Setup SvelteKit project
- [x] Add Tailwind CSS
- [x] Create base folders (`/components /lib /routes /stores /types`)
- [x] Define `Idea` type (`src/types/Idea.ts`)
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
- [x] Deploy

> **Deploy status:** the repository is deploy-ready (multi-stage Dockerfile,
> `.env.example`, `/healthz` that returns 503 on a missing `PUBLIC_CONVEX_URL`,
> and `docs/DEPLOY.md`). **No deployment has been performed** — a Convex
> production deployment is billed separately and creating one, plus a public URL,
> is the owner's decision. See `docs/DEPLOY.md`.

## 3.1 What "done" means here, and what is still open

All eight weeks are implemented. None of them has been verified by a person
looking at the screen, because no browser has ever been attached to the
development session for this project. That distinction matters more than the
checkboxes above, so it is recorded here rather than left to be discovered:

**Verified by execution**
- Backend: `npm run verify:e2e` — 117 live checks against the dev deployment,
  including every negative authorization case. `svelte-check` clean.
- Capture/editor preservation: `scripts/verify-capture-regressions.ts`, offline.
- Keyboard shortcuts: `npm run verify:shortcuts` — 36 checks.
- React Native client: typecheck and lint clean, Expo Doctor 21/21, Android and
  iOS Hermes exports pass. Exports prove bundling, not native rendering.
- Swift client: a static contract check over 16 backend functions. Compilation,
  simulator and device testing need Apple SDKs and are unverified on this host.

**Not verified — needs a browser or a device**
- Any rendered UI: layout, CSS, contrast as painted, focus rings, drag-and-drop
  on a touchscreen.
- The Android on-device journey and the entire iOS journey.
- A production deployment of any kind.

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

**Acceptance criteria (Phase 1)**

- [ ] Create, edit, delete an idea
- [ ] Assign tags
- [ ] Set status (Parked / Reviewing / Ready)
- [ ] Persist locally across refresh

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