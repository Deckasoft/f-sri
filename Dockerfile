# syntax=docker/dockerfile:1
#
# Multi-stage build for the F Sri API + the admin/onboarding SPA.
#
# Stages:
#   1. backend-deps   — installs backend npm deps (incl. devDependencies:
#                        ts-node/typescript, needed at runtime for
#                        `npm run create-admin`) and lets Puppeteer download
#                        its own Chromium build.
#   2. backend-build   — compiles src/ -> dist/ with tsc.
#   3. admin-build     — builds the Vite/React SPA (admin/) -> admin/dist/.
#   4. runtime         — node:20-slim + the Debian shared libraries Chromium
#                        needs, running as the unprivileged `node` user.
#
# Puppeteer/Chromium strategy (see task-7-report.md for the full write-up):
# src/utils/pdf.utils.ts calls `puppeteer.launch()` with no `executablePath`,
# so this Dockerfile lets Puppeteer manage its own bundled Chromium (the
# default behavior) rather than installing distro `chromium` +
# PUPPETEER_EXECUTABLE_PATH. That avoids touching pdf.utils.ts in a
# deployment-only phase. PUPPETEER_CACHE_DIR is pinned to the same absolute
# path in every stage so the browser downloaded during `npm ci` is found by
# puppeteer.launch() at runtime, and the cache dir is chowned to `node` since
# it's downloaded while still root in the deps stage.

ARG NODE_VERSION=20-slim

# ---------------------------------------------------------------------------
# Stage 1: backend dependencies (+ Puppeteer's Chromium download)
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS backend-deps

WORKDIR /app

# Puppeteer's postinstall script downloads Chromium into this dir. Pin it
# explicitly (rather than relying on the default ~/.cache/puppeteer) so every
# stage below references the exact same absolute path.
ENV PUPPETEER_CACHE_DIR=/home/node/.cache/puppeteer

COPY package.json package-lock.json ./
# Full `npm ci` (dependencies + devDependencies) on purpose: ts-node and
# typescript (devDependencies) are kept in the final image so `npm run
# create-admin` — a ts-node script — works inside the running container.
RUN npm ci

# ---------------------------------------------------------------------------
# Stage 2: compile TypeScript -> dist/
# ---------------------------------------------------------------------------
FROM backend-deps AS backend-build

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 3: build the admin/onboarding SPA -> admin/dist/
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS admin-build

WORKDIR /app/admin

COPY admin/package.json admin/package-lock.json ./
RUN npm ci

COPY admin/ ./
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 4: runtime image
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime

# Debian (bookworm, matching node:20-slim) shared libraries required by the
# Chromium build Puppeteer downloads. Verified installable on this exact base
# image (see task-7-report.md) — names differ across Debian releases, so
# re-verify if the base image is ever bumped.
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

# Backend: full node_modules (incl. devDependencies, see backend-deps stage),
# compiled dist/, and the plain-TS scripts/ dir (run via ts-node/create-admin).
# scripts/create-admin.ts imports directly from '../src/...' (e.g.
# src/config/env.config, src/models/User) and is executed via ts-node, not
# tsc — so src/ itself must be present at runtime too, not just dist/
# (verified: omitting src/ here makes `npm run create-admin` fail inside the
# container with "Cannot find module '../src/config/env.config'").
COPY --from=backend-build --chown=node:node /app/node_modules ./node_modules
COPY --from=backend-build --chown=node:node /app/dist ./dist
COPY --from=backend-build --chown=node:node /app/src ./src
COPY --from=backend-build --chown=node:node /app/scripts ./scripts
COPY --from=backend-build --chown=node:node /app/tsconfig.json ./tsconfig.json
COPY --from=backend-build --chown=node:node /app/package.json ./package.json

# Puppeteer's downloaded Chromium, re-owned to the `node` user this image
# runs as (it was downloaded as root in the backend-deps stage).
COPY --from=backend-deps --chown=node:node /home/node/.cache/puppeteer /home/node/.cache/puppeteer

# The admin/onboarding SPA — served by src/staticSpa.ts from ../admin/dist
# relative to dist/index.js, i.e. /app/admin/dist here.
COPY --from=admin-build --chown=node:node /app/admin/dist ./admin/dist

USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]
