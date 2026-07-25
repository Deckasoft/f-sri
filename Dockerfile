# syntax=docker/dockerfile:1
#
# Multi-stage build for the F Sri API + the admin/onboarding SPA.
#
# ⚠️  BUILDING ON APPLE SILICON (arm64) MACS: pass `--platform linux/amd64`.
#     Google does not publish an official Linux ARM64 Chrome-for-Testing
#     build, so Puppeteer's downloader falls back to an x64 Chromium binary
#     even on an arm64 host/image. A plain `docker build .` on an M-series
#     Mac produces an image that builds fine but whose Chromium cannot
#     launch at runtime (`rosetta error: failed to open elf at
#     /lib64/ld-linux-x86-64.so.2`) — silently broken PDF generation for a
#     tax-document system. A real Hostinger VPS is x86_64, so this is a
#     local-build-only concern:
#         docker build --platform linux/amd64 -t f-sri .
#     (Docker Desktop emulates amd64 via QEMU automatically; this only adds
#     build time, it does not require extra setup.)
#
# Stages:
#   1. backend-deps      — full `npm ci` (incl. devDependencies, so
#                           typescript is available to compile) + lets
#                           Puppeteer download its own Chromium. Used only to
#                           build things, never copied into the runtime image
#                           wholesale.
#   2. backend-build      — compiles src/ -> dist/ and scripts/create-admin.ts
#                           -> dist-scripts/ with tsc (two separate outputs,
#                           see tsconfig.build.json / tsconfig.scripts.json).
#   3. backend-deps-prod  — a SEPARATE, production-only `npm ci --omit=dev`:
#                           no ts-node/typescript in the final image. Skips
#                           re-downloading Chromium (PUPPETEER_SKIP_CHROMIUM_
#                           DOWNLOAD=true) since the runtime stage reuses the
#                           browser binary already downloaded in backend-deps.
#   4. admin-build        — builds the Vite/React SPA (admin/) -> admin/dist/.
#   5. runtime            — node:20-slim + the Debian shared libraries
#                           Chromium needs, running as the unprivileged
#                           `node` user. Ships ONLY: production node_modules,
#                           dist/, dist-scripts/, admin/dist/, and the
#                           Puppeteer browser cache — no src/, no scripts/,
#                           no tsconfig*.json, no devDependencies. This
#                           container holds clients' .p12 signing
#                           certificates and emits legally-binding tax
#                           documents, so minimizing what a compromise
#                           elsewhere could reach here (a TS interpreter, the
#                           full source tree) is worth the extra stage.
#
# Puppeteer/Chromium download strategy (see task-7-report.md for the full
# write-up): src/utils/pdf.utils.ts calls `puppeteer.launch()` with no
# `executablePath`, so this Dockerfile lets Puppeteer manage its own bundled
# Chromium (the default behavior) rather than installing distro `chromium` +
# PUPPETEER_EXECUTABLE_PATH — that would mean touching pdf.utils.ts in a
# deployment-only phase. PUPPETEER_CACHE_DIR is pinned to the same absolute
# path in every stage so the browser downloaded once in backend-deps is
# found by puppeteer.launch() at runtime, after being re-owned to `node`
# (it's downloaded as root in backend-deps).

ARG NODE_VERSION=20-slim

# ---------------------------------------------------------------------------
# Stage 1: backend dependencies (+ Puppeteer's Chromium download) — build-only
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS backend-deps

WORKDIR /app

ENV PUPPETEER_CACHE_DIR=/home/node/.cache/puppeteer

COPY package.json package-lock.json ./
# Full `npm ci` (dependencies + devDependencies): typescript (devDependency)
# is needed to run `npm run build`/`npm run build:scripts` in the next
# stage. This stage's node_modules is NEVER copied into the runtime image —
# see backend-deps-prod below for the lean, production-only install that is.
RUN npm ci

# ---------------------------------------------------------------------------
# Stage 2: compile TypeScript -> dist/ and dist-scripts/
# ---------------------------------------------------------------------------
FROM backend-deps AS backend-build

COPY tsconfig.json tsconfig.build.json tsconfig.scripts.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build && npm run build:scripts

# ---------------------------------------------------------------------------
# Stage 3: production-only node_modules (no ts-node/typescript/etc.)
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS backend-deps-prod

WORKDIR /app

# Chromium is NOT re-downloaded here: the runtime stage copies the browser
# binary already fetched in backend-deps. Puppeteer (a regular dependency)
# still installs normally; only its postinstall download is skipped.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

COPY package.json package-lock.json ./
# `--omit=dev` does NOT fully exclude `typescript` here: puppeteer (a real
# runtime dependency) depends on cosmiconfig, which declares typescript as
# an *optional peer* (peerDependenciesMeta) — npm satisfies that from our
# own devDependency during lockfile resolution and marks the resulting
# node_modules/typescript entry "devOptional" rather than plain "dev", so
# `--omit=dev` alone leaves it installed (verified: it showed up in the
# runtime image even after this flag). cosmiconfig only requires typescript
# on demand to load a `.ts`-format config file — puppeteer only uses
# cosmiconfig to load its own optional `.puppeteerrc`, which this project
# doesn't have, so typescript is genuinely never exercised at runtime here.
# Removing it explicitly is what actually keeps the TS compiler out of the
# production image (drop this line and re-verify with `find node_modules
# -maxdepth 1 -name typescript` if the dependency tree ever changes).
RUN npm ci --omit=dev && rm -rf node_modules/typescript

# ---------------------------------------------------------------------------
# Stage 4: build the admin/onboarding SPA -> admin/dist/
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS admin-build

WORKDIR /app/admin

COPY admin/package.json admin/package-lock.json ./
RUN npm ci

COPY admin/ ./
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 5: runtime image
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime

# Debian (bookworm, matching node:20-slim) shared libraries required by the
# Chromium build Puppeteer downloads. Verified installable on this exact base
# image (see task-7-report.md) — names differ across Debian releases, so
# re-verify if the base image is ever bumped. `wget` also doubles as the
# compose healthcheck's HTTP client (see compose.prod.yml) — it doesn't need
# a separate install.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        fonts-liberation \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libc6 \
        libcairo2 \
        libcups2 \
        libdbus-1-3 \
        libexpat1 \
        libfontconfig1 \
        libgbm1 \
        libgcc1 \
        libglib2.0-0 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libpango-1.0-0 \
        libpangocairo-1.0-0 \
        libstdc++6 \
        libx11-6 \
        libx11-xcb1 \
        libxcb1 \
        libxcomposite1 \
        libxcursor1 \
        libxdamage1 \
        libxext6 \
        libxfixes3 \
        libxi6 \
        libxrandr2 \
        libxrender1 \
        libxshmfence1 \
        libxss1 \
        libxtst6 \
        lsb-release \
        wget \
        xdg-utils \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    PUPPETEER_CACHE_DIR=/home/node/.cache/puppeteer

WORKDIR /app

# Production-only node_modules (no ts-node/typescript — see backend-deps-prod).
COPY --from=backend-deps-prod --chown=node:node /app/node_modules ./node_modules

# Compiled backend: the API entrypoint and the precompiled create-admin
# script. No src/, no scripts/, no tsconfig*.json in the runtime image.
COPY --from=backend-build --chown=node:node /app/dist ./dist
COPY --from=backend-build --chown=node:node /app/dist-scripts ./dist-scripts

# Puppeteer's downloaded Chromium, re-owned to the `node` user this image
# runs as (it was downloaded as root in the backend-deps stage).
COPY --from=backend-deps --chown=node:node /home/node/.cache/puppeteer /home/node/.cache/puppeteer

# The admin/onboarding SPA — served by src/staticSpa.ts from ../admin/dist
# relative to dist/index.js, i.e. /app/admin/dist here.
COPY --from=admin-build --chown=node:node /app/admin/dist ./admin/dist

USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]
