# Deploying ThinkLot

ThinkLot is two deployables that are versioned independently and must agree:

| Piece | What it is | Deployed with |
| --- | --- | --- |
| **Backend** | Convex functions + database | `npx convex deploy` |
| **Frontend** | SvelteKit on `adapter-node` | Docker, or any Node host |

The frontend never talks to the database directly. It only knows one thing: the
Convex deployment URL. That is why the order matters — **backend first**, or the
frontend will start up pointing at a deployment that has no functions.

---

## What has been verified, and what has not

Verified locally, from a production `npm run build`:

- `npm run build` exits 0 and emits a runnable `build/index.js`
- `node build/index.js` serves `/`, `/login`, `/signup`, `/ideas`, `/board`,
  `/review`, `/archive` with HTTP 200
- `GET /healthz` returns `200 {"ok":true,"convexHost":"…"}` when
  `PUBLIC_CONVEX_URL` is set
- `GET /healthz` returns `503` with a named reason when it is **not** set

**Not verified:** no deployment has been performed, no production Convex
deployment exists, and no rendered UI has been checked in a browser. See
`docs/THINKLOT-SPEC.md` for the full status.

---

## 1. Backend — a Convex production deployment

Production deployments on Convex are **billed separately from the free plan**.
The dev deployment used during development is already over its Free-plan quota,
so do this deliberately rather than by accident.

```bash
npx convex deploy          # creates and pushes to a production deployment
npx convex env list        # confirm JWT_PRIVATE_KEY, JWKS and SITE_URL
```

If the project has no production deployment yet, `npx convex deploy` will ask to
create one and will print the URL. That URL is what the frontend needs.

Set the auth environment variables **on the production deployment**:

```bash
npx convex env set JWT_PRIVATE_KEY "<pem>"
npx convex env set JWKS          '<json>'
npx convex env set SITE_URL      "https://your-domain"
```

`SITE_URL` matters: it is the OAuth / magic-link callback origin. Leaving it
pointing at localhost is the classic "works on my machine" auth bug.

---

## 2. Frontend

### Option A — Docker (recommended)

The `Dockerfile` is a four-stage build: full install → build → production-only
install → runtime. The runtime image has no compiler, no dev dependencies and no
source.

```bash
docker build --build-arg PUBLIC_CONVEX_URL="https://your-deployment.convex.cloud" -t thinklot .
docker run -p 3000:3000 -e PUBLIC_CONVEX_URL="https://your-deployment.convex.cloud" thinklot
curl -i localhost:3000/healthz      # expect 200
```

Two details in that Dockerfile that are easy to get wrong elsewhere:

- **PID 1 is `node`, not `npm start`.** Through npm, SIGTERM does not reach the
  server, so every rolling deploy ends in a 10-second kill.
- **`--omit=dev` for the runtime layer.** The build needs the full tree; the
  runtime does not.

### Option B — Any Node host

No container needed. `adapter-node` output is self-contained.

```bash
npm ci
npm run build
PUBLIC_CONVEX_URL="https://your-deployment.convex.cloud" ORIGIN="https://your-domain" node build/index.js
```

`ORIGIN` must match the real origin. SvelteKit uses it for CSRF protection on
form actions; a mismatch produces confusing form errors rather than an obvious
failure.

### Environment variables required at runtime

| Variable | Required | Notes |
| --- | --- | --- |
| `PUBLIC_CONVEX_URL` | **yes** | Your Convex deployment URL. Missing it renders a **blank page**, not an error — check `/healthz`. |
| `ORIGIN` | recommended | The deployed origin, for CSRF checks. |
| `PORT` | no | Defaults to 3000. |
| `HOST` | no | Set to `0.0.0.0` in containers. |

There is exactly **one** application env var. Everything else belongs on the
Convex deployment — see `.env.example`.

---

## 3. Verifying a deployment

Do not stop at "the deploy succeeded". In order:

1. `curl -i https://your-domain/healthz` → **200**, `convexConfigured: true`
   A 503 here means the frontend is up but useless, and it is the single most
   likely silent failure.
2. Load `/` and `/login` in a real browser. **This has never been done for this
   project** — see the caveat above.
3. Sign up, capture an idea, confirm it appears.
4. Sign in from a second browser profile to confirm the same data appears.
   This is the only test that catches "deployed against the wrong Convex
   deployment", which produces an app that looks fine and is empty.

---

## Things that will bite you

**A wrong `PUBLIC_CONVEX_URL` is a blank page, not an error.** Every page opens a
Convex subscription, so a null client throws inside an `$effect` and Svelte tears
the tree down. This used to crash; it now renders an error banner naming the
variable. `/healthz` reports it as a 503 so a load balancer notices.

**Deploy the backend before the frontend.** Otherwise the frontend resolves, the
health check passes, and every query fails.

**Convex Auth rate limiting is keyed on the account id.** Known accounts are
throttled at 5 failed attempts per hour; unknown addresses are not throttled at
all. See `src/convex/auth.ts` for why that cannot be fixed from config.

**Account enumeration is a known, accepted residual risk.** Convex Auth v1
rethrows distinguishable errors from a public action. The three fixes that were
built and rejected are recorded in `src/convex/auth.ts`.

**The dev deployment holds test data.** `scripts/verify-e2e.ps1` creates two
accounts per run and does not clean up after itself. Do not point a production
deployment at the dev URL "just to check" — the data is already messy there.
