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
- [ ] Create store (`src/stores/ideas.store.ts`)
- [ ] Basic list + create form
- [ ] LocalStorage persistence

### Week 2 — Tagging + search + statuses

- [ ] Tag input + tag list filtering
- [ ] Search by title/description
- [ ] Status pipeline (Inbox / Parked / Reviewing / Ready)
- [ ] Card view + list view toggle

### Week 3 — Kanban board + drag & drop

- [ ] Board view route
- [ ] Drag between statuses
- [ ] Idea details page

### Week 4 — Scoring engine + dashboard

- [ ] Impact / Effort / Confidence inputs
- [ ] Priority score formula: `(Impact × Confidence) / Effort`
- [ ] Sort + highlight top ideas
- [ ] Dashboard widgets (counts + top ideas)

### Week 5 — Review system + reminders

- [ ] Review queue rules (7 days untouched, parked, high score)
- [ ] Snooze / archive / promote actions
- [ ] Revisit reminder logic

### Week 6 — Convert idea → action

- [ ] IdeaTasks schema + checklist UI
- [ ] Progress indicator per idea

### Week 7 — Backend + auth

- [ ] Auth + sync

### Week 8 — Polish + deploy

- [ ] Keyboard shortcuts
- [ ] Dark mode
- [ ] Deploy

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