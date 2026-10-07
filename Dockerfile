# ThinkLot — production image.
#
# Multi-stage so the runtime layer carries no compiler, no dev dependencies and
# no source. adapter-node emits a self-contained `build/` plus a `node_modules`
# of runtime dependencies only, which is what `npm ci --omit=dev` below
# produces.

# ---------------------------------------------------------------------------
# 1. Install every dependency, including dev, because the build needs them.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# 2. Build. PUBLIC_CONVEX_URL is a build-time value for SvelteKit's $env/dynamic
#    public surface only in that it must EXIST for the build to succeed; it is
#    read at runtime from the environment. Declared here so a missing value is a
#    build failure rather than a blank page in production.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG PUBLIC_CONVEX_URL
ENV PUBLIC_CONVEX_URL=$PUBLIC_CONVEX_URL
RUN npm run build

# ---------------------------------------------------------------------------
# 3. Runtime dependencies only.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---------------------------------------------------------------------------
# 4. Run.
#
# `node` rather than `npm start` so PID 1 is the server itself and receives
# SIGTERM directly; through npm it does not, and every rolling deploy ends in a
# 10-second kill.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./package.json

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "build/index.js"]
