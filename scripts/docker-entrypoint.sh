#!/bin/sh
set -e

DB_FILE="${DATABASE_URL#file:}"

if [ ! -f "$DB_FILE" ]; then
  echo "[servo] No database found at $DB_FILE — running initial setup…"
  npx prisma db push --skip-generate
  npx tsx prisma/seed.ts
else
  # Upgrades: db push is idempotent, so applying it every boot keeps an
  # existing volume in step with a newer image's schema without touching data.
  echo "[servo] Using existing database at $DB_FILE — syncing schema…"
  npx prisma db push --skip-generate
fi

exec npm run start
