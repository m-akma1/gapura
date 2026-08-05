#!/bin/sh
# Runs once, before any service starts, then exits.
#
# Three processes share the gapura database, so no service may migrate in its
# own entrypoint: they would race on startup. This is the single owner of schema
# changes for all three databases.
set -eu

base="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}"

echo "migrator: gapura"
DATABASE_URL="${base}/gapura" pnpm --filter @gapura/auth-core exec prisma migrate deploy

echo "migrator: keraton"
DATABASE_URL="${base}/keraton" pnpm --filter @gapura/keraton exec prisma migrate deploy

echo "migrator: joglo"
DATABASE_URL="${base}/joglo" pnpm --filter @gapura/joglo exec prisma migrate deploy

echo "migrator: seed"
DATABASE_URL="${base}/gapura" node auth-provider/core/dist/seed.js

echo "migrator: done"
