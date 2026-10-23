# LiaraPilot — production image for Liara PaaS (platform: docker)
#
# Stage 1 (builder): bun installs deps, prisma generates the client,
#                    `next build` emits the standalone output.
# Stage 2 (runner):  node runs the standalone server; the official @liara/cli
#                    is installed so a deployed LiaraPilot can perform REAL
#                    Liara operations (gated on LIARA_API_TOKEN at runtime).
#
# SQLite lives on a Liara disk mounted at /app/data (see liara.json).

# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Builder — musl (alpine) so the Prisma engines baked into the standalone
# output match the musl runner image.
# ---------------------------------------------------------------------------
FROM oven/bun:1.3-alpine AS builder

WORKDIR /app

# Build-time placeholder so PrismaClient can be constructed during static
# analysis of route modules; it is never queried at build time.
ENV DATABASE_URL="file:/tmp/build-placeholder.db" \
    NEXT_TELEMETRY_DISABLED=1

# 1) Dependencies (lockfile-first for layer caching)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile \
    && bun -e "console.log(require('./node_modules/prisma/package.json').version)" > .prisma-version

# 2) Prisma client (before copying the rest — schema rarely changes)
COPY prisma ./prisma
RUN bunx prisma generate

# 3) Source + build
COPY . .
RUN bun run build

# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# openssl: Prisma linux-musl engine dependency; wget: container healthCheck.
RUN apk add --no-cache openssl wget \
    && addgroup -S app && adduser -S app -G app

WORKDIR /app

# Next.js standalone server (includes traced node_modules, .prisma client,
# static assets and public/ — package.json build script copies them in).
COPY --from=builder /app/.next/standalone ./
COPY prisma ./prisma
COPY docker-entrypoint.sh ./docker-entrypoint.sh

# Prisma CLI with its COMPLETE dependency closure (effect, @prisma/config,
# engines, ...). Copying bare node_modules/prisma is NOT enough — the CLI's
# transitive deps are hoisted elsewhere by bun, which caused
# "Cannot find module 'effect'" at container start. npm resolves the full
# tree here, and the version is pinned to the exact one used at build time.
COPY --from=builder /app/.prisma-version /tmp/.prisma-version
RUN mkdir -p /opt/prisma-cli \
    && cd /opt/prisma-cli \
    && npm init -y >/dev/null 2>&1 \
    && npm install --silent --no-audit --no-fund \
         "prisma@$(cat /tmp/.prisma-version)" \
    && ln -sf /opt/prisma-cli/node_modules/.bin/prisma /usr/local/bin/prisma \
    && prisma --version | head -2

# The official Liara CLI — lets the deployed agent execute real, approved
# Liara operations (deploy/logs/restart) when LIARA_API_TOKEN is configured.
RUN npm install -g --silent @liara/cli \
    && chmod +x ./docker-entrypoint.sh \
    && mkdir -p /app/data \
    && chown -R app:app /app

USER app

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
