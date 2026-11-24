#!/bin/sh
set -e

# 1. Schema: use committed migrations when present, otherwise push the schema (first-run convenience).
if [ -d prisma/migrations ] && [ -n "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  npx prisma migrate deploy
else
  echo "No prisma/migrations found: using 'prisma db push'. Commit migrations for production."
  npx prisma db push --skip-generate
fi

# 2. Company settings + first admin from environment (idempotent, no demo data).
npx tsx prisma/bootstrap.ts

# 3. Optional: the Section 5 benchmark master data and opening balances for evaluators.
if [ "$LOAD_BENCHMARK_SEED" = "true" ]; then
  npx tsx prisma/seed.ts
fi

exec npx next start -H 0.0.0.0 -p "${PORT:-3000}"
