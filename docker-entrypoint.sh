#!/bin/sh
# LiaraPilot container entrypoint.
# Responsibilities (in order):
#   1. Defaults for PORT / DATABASE_URL (Liara mounts persistent disks at /app/data).
#   2. Make sure the SQLite file lives on the mounted disk and its schema exists
#      (`prisma db push` is idempotent — a no-op when the schema already matches).
#   3. Hand off to the Next.js standalone server (respects PORT / HOSTNAME).
set -e

: "${PORT:=3000}"
: "${HOSTNAME:=0.0.0.0}"
: "${DATABASE_URL:=file:/app/data/liarapilot.db}"
export PORT HOSTNAME DATABASE_URL

DB_FILE="${DATABASE_URL#file:}"
DB_DIR="$(dirname "$DB_FILE")"
if [ ! -d "$DB_DIR" ]; then
  echo "[entrypoint] creating database directory: $DB_DIR"
  mkdir -p "$DB_DIR" 2>/dev/null || echo "[entrypoint] WARNING: could not create $DB_DIR (read-only fs?)"
fi

echo "[entrypoint] DATABASE_URL=$DATABASE_URL PORT=$PORT"

# Schema sync against the (possibly fresh) SQLite file on the mounted disk.
# Uses the standalone Prisma CLI installed at /usr/local/bin/prisma (full
# dependency closure — see Dockerfile). Idempotent on every boot.
if prisma db push --schema ./prisma/schema.prisma --skip-generate --accept-data-loss; then
  echo "[entrypoint] database schema is up to date"
else
  echo "[entrypoint] WARNING: prisma db push failed — continuing; health endpoint will report degraded until the disk is writable."
fi

exec node server.js
