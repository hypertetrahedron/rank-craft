/**
 * Create the RankCraft tables in Neon.
 *
 *   node --env-file=.env.local scripts/db-setup.mjs
 *
 * Idempotent — safe to re-run. `npm run db:push` via drizzle-kit does the same
 * thing from the schema; this exists so setup works without the drizzle CLI and
 * so the SQL is readable.
 */
import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.')
  process.exit(1)
}

const sql = neon(url)

const statements = [
  `CREATE EXTENSION IF NOT EXISTS pgcrypto`,

  `CREATE TABLE IF NOT EXISTS owners (
     id         uuid PRIMARY KEY,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS functions (
     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     owner_id    uuid,
     kind        text NOT NULL,
     name        text NOT NULL,
     description text NOT NULL DEFAULT '',
     code        text NOT NULL,
     params      jsonb NOT NULL DEFAULT '{}'::jsonb,
     is_builtin  boolean NOT NULL DEFAULT false,
     version     integer NOT NULL DEFAULT 1,
     parent_id   uuid,
     created_at  timestamptz NOT NULL DEFAULT now(),
     updated_at  timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS functions_owner_kind_idx ON functions (owner_id, kind)`,

  `CREATE TABLE IF NOT EXISTS configs (
     id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     owner_id   uuid,
     name       text NOT NULL,
     payload    jsonb NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS configs_owner_idx ON configs (owner_id)`,

  `CREATE TABLE IF NOT EXISTS runs (
     id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     owner_id     uuid,
     label        text NOT NULL,
     config       jsonb NOT NULL,
     result       jsonb NOT NULL,
     seed         integer NOT NULL,
     replications integer NOT NULL,
     kendall_tau  double precision,
     created_at   timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS runs_owner_idx ON runs (owner_id, created_at)`,
]

for (const stmt of statements) {
  await sql(stmt)
  console.log('  ok  ' + stmt.split('\n')[0].trim())
}
console.log('\nSchema is up to date.')
