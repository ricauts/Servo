#!/bin/sh
set -e

DB_FILE="${DATABASE_URL#file:}"

if [ ! -f "$DB_FILE" ]; then
  echo "[servo] No database found at $DB_FILE — running initial setup…"
  npx prisma db push --skip-generate
  if [ "$SERVO_DEMO" = "1" ]; then
    echo "[servo] SERVO_DEMO=1 — loading the showcase dataset…"
    npx tsx prisma/seed-demo.ts
  else
    npx tsx prisma/seed-core.ts
  fi
else
  # Upgrades: db push is idempotent, so applying it every boot keeps an
  # existing volume in step with a newer image's schema without touching
  # data; the core seed backfills anything a newer version added.
  echo "[servo] Using existing database at $DB_FILE — syncing schema…"
  npx prisma db push --skip-generate
  npx tsx prisma/seed-core.ts
fi

exec npm run start
