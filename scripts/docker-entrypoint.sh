#!/bin/sh
set -e

# First boot: create the schema and seed demo data if the database is missing.
DB_FILE="${DATABASE_URL#file:}"
if [ ! -f "$DB_FILE" ]; then
  echo "[servo] No database found at $DB_FILE — running initial setup…"
  npx prisma db push --skip-generate
  npx tsx prisma/seed.ts
else
  echo "[servo] Using existing database at $DB_FILE"
fi

exec npm run start
