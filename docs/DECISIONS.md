# Architecture decisions — the four deferred questions

Four questions were deliberately left undecided because they were not mine to answer:
the account-enumeration residual, the AI features, public sharing, and verification
strategy. Four staff-level reviews were run against the live deployment and installed
dependencies. This file records what they decided and, importantly, **what has been
acted on and what has not**.

Nothing here was accepted on trust. Each load-bearing claim was re-checked against
`node_modules`, the installed CLI, or the running deployment before being written down.

---

## 1. Account enumeration — **fixable after all**

**Decision: own credential authorization with a custom `ConvexCredentials` provider,
and keep Convex Auth's session machinery.**

My earlier note claimed this was blocked on the library's internal JWT signing. That
was wrong, and it is the sixth "impossible" claim in this repo to be wrong on
inspection.

- `ConvexCredentials.authorize` accepts an **async** implementation returning
  `{ userId, sessionId? }` — it does not need a JWT.
- `handleCredentials` takes that result and calls the library's own session/token
  machinery.
- Public `createAccount` / `retrieveAccount` helpers are exported, and lucia 3.2.2
  exports `Scrypt`, so password verification can be reproduced faithfully.

So the shape of the fix is: keep the library's **public** sign-in action (closing the
raw oracle), move rate-limiting *into* authorization so raw calls are metered too, and
normalise every credential failure at one throw site.

**Two findings that change the risk picture:**

- **The proxy is not the enforcement boundary.** The Swift client and Expo's React
  provider both call raw `auth:signIn` directly. Metering inside the proxy meters the
  web app only.
- **A signup enumeration residual survives this.** Duplicate-rejection versus
  successful creation still reveals whether an address exists. Closing that needs a
  verified-email enrollment flow; it is not inherently impossible.

**Status: NOT YET IMPLEMENTED.** Highest-value security item outstanding.

---

## 2. AI features — **ship deterministic duplicate detection first**

**Decision: build duplicate detection locally and deterministically now. Add
summarisation later, as an explicitly consented, budget-capped Convex action. Do not
start with embeddings.**

The key correction: **related ideas are not duplicate ideas.** Two postmortems can
share `#handover` and describe entirely different incidents. `src/lib/clustering.ts`
correctly treats shared tags as evidence of relatedness — that evidence is simply not
sufficient evidence of duplication.

Recommended: a separate pure module using normalised exact-title matches, character
n-gram similarity, IDF-weighted lexical overlap, and shared tags as *supporting*
evidence only — returning pairwise suggestions with explanations. Explicitly **do not**
chain similarity edges into clusters; that recreates the problem clustering avoids.

Why not embeddings first: cosine similarity is **not** a duplicate probability, and a
universal threshold such as `0.85` would be unjustified. The named failure modes are
similar-topic-mistaken-for-same-action, negation and audience loss, long-note
truncation, and top-k always returning neighbours even when none are credible.
Worth revisiting only once owner-labelled examples show lexical misses actually hurt.

Modelled cost (GPT-4.1-mini, ~1,200 in / 150 out ≈ **$0.00072 per summary**):
100 ideas ≈ $0.07/mo, 1,000 ≈ $0.72/mo, 10,000 ≈ $7.20/mo if every idea is summarised
monthly. **Note the charge is per summary, not per stored idea** — retaining 10,000
ideas costs nothing until they are processed.

Known limits to disclose in the UI: `ideas.list` stops at 250 rows with a 160-character
description preview, and related-idea computation scans at most 250. Raising those caps
would reintroduce the documented read-limit problem.

**Status: NOT YET IMPLEMENTED.** This is the next backlog item — pure function, no
provider, no budget decision.

---

## 3. Public sharing — **server-gated snapshot, no public Convex query**

**Decision: an expiring, revocable link to an owner-reviewed snapshot of one idea,
served through a SvelteKit server route. Add no anonymous Convex public query.**

The decisive constraint: **Convex public queries are reachable without auth over the
HTTP API**, so anything public becomes a permanent public attack surface. Reading a
token out of the URL in a public query is not a control.

- Separate `ideaShares` table — a token *field* on `ideas` risks existing
  document-returning APIs accidentally handing out bearer credentials.
- 32 cryptographically random bytes, base64url. Store only SHA-256; return the raw
  token once. Default 7-day expiry, hard max 30.
- The anonymous page calls **server** code, which authenticates to Convex with a
  server-only secret before reading. Hidden URLs and CORS provide no authorization.
- The reader must touch only `ideaShares` — never `ideas.get`, stats, clustering,
  tasks, events or counters.

**Published fields: `publicTitle` and an optional `publicSummary`, separately supplied
and explicitly previewed. Never expose** the dictated transcript, email, internal IDs,
`seq` (a monotonic per-user value that leaks capture history), tags, scores, tasks,
activity or related ideas. Suppress `seq` specifically: it reveals history even when
deletions make it an inaccurate current count.

Missing, malformed, revoked, expired and deleted must all return the **same** generic
response, with no owner/idea/pagination arguments accepted.

Honest limit: rate-limiting before Convex reduces database amplification but **cannot
guarantee a billing cap**, because direct attacks on the HTTP action still consume
executions even when the secret is rejected. With the account already over quota, that
residual needs an explicit release budget — otherwise sharing stays off.

**Status: NOT YET IMPLEMENTED.** Needs the owner's billing decision.

---

## 4. Verification — **quota-free checks gate merges; live runs are budgeted**

**Decision: `check`, `verify:offline` and the production build are the required merge
gate and need no backend. Live suites run nightly against one isolated deployment,
sequentially, with no auto-retry, and only once a cleanup strategy works.**

Two prerequisites the review found:

1. **`verify-e2e.ps1` had no exit code at all.** It printed `FAILED: 1` in red and
   returned 0, so any CI wired to it would have gone green on a broken backend.
   **Fixed and verified** — an injected failure now returns 1.
2. **The account leak was worse than documented.** The script creates **four**
   accounts per run (A, B, clustering, throttle) and cleans up none. It reported only
   two. **Fixed** — all four are now listed, so a cleanup strategy built from that list
   does not orphan fixtures.

Cleanup must use per-run accounts (preserving real signup and isolation coverage),
registered *before* signup so a lost response cannot orphan an account, torn down via a
narrowly scoped internal function restricted to the test deployment and run ID.
**Never expose arbitrary-user deletion publicly, and never authorise it through the
test user's password** — the throttle fixture locks that account on purpose.

Deletion is not complete until old access and refresh tokens are proven rejected:
installed `getAuthUserId` only parses identity, so an existing JWT may remain usable
until expiry.

Scale thresholds proposed (targets, **not** measured): any ownership leak, lost write,
wrong ordering or undocumented omission; >1% request failures; p95 query >500 ms; fast-path
reads above 251; forecast usage over budget.

**Status: PARTIALLY IMPLEMENTED** — the exit code and account reporting are fixed. No CI
has been created yet.

---

## Also found and fixed: the Docker image could not build

`.dockerignore` excluded the whole `src/convex` directory — which contains
`_generated`. Nine web modules import the generated `api` proxy **at runtime**, so the
image's production build failed on missing modules. Nothing had caught it because no
Docker build has ever been run here.

Fixed by excluding the convex **files** rather than the directory. That detail matters:
Docker stops descending into an excluded directory, so a later `!src/convex/_generated`
exception would never have been evaluated.