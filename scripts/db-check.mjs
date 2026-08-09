/**
 * Verify the live database matches what the application expects.
 *
 *   node --env-file=.env.local scripts/db-check.mjs
 *
 * `db:setup` reporting "ok" only means the DDL ran; it says nothing about
 * whether the columns the Drizzle schema reads are the columns that exist. This
 * checks that, and reports what is stored, without ever printing a credential.
 */
import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set. Run with --env-file=.env.local')
  process.exit(1)
}

const sql = neon(url)

/** Columns the application reads or writes, by table. */
const EXPECTED = {
  owners: ['id', 'created_at'],
  functions: [
    'id', 'owner_id', 'kind', 'name', 'description', 'code', 'params',
    'is_builtin', 'version', 'parent_id', 'created_at', 'updated_at',
  ],
  configs: ['id', 'owner_id', 'name', 'payload', 'created_at', 'updated_at'],
  runs: [
    'id', 'owner_id', 'label', 'config', 'result', 'seed', 'replications',
    'kendall_tau', 'created_at',
  ],
}

// Never log the connection string; the host alone is enough to know which
// database you are pointed at.
const host = url.match(/@([^/?]+)/)?.[1] ?? 'unknown'
console.log(`database: ${host}\n`)

let problems = 0

const actual = await sql`
  SELECT table_name, column_name, data_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
  ORDER BY table_name, ordinal_position
`

const byTable = new Map()
for (const row of actual) {
  if (!byTable.has(row.table_name)) byTable.set(row.table_name, new Map())
  byTable.get(row.table_name).set(row.column_name, row.data_type)
}

for (const [table, columns] of Object.entries(EXPECTED)) {
  const found = byTable.get(table)
  if (!found) {
    console.log(`  MISSING TABLE  ${table}`)
    problems++
    continue
  }
  const missing = columns.filter((c) => !found.has(c))
  const extra = [...found.keys()].filter((c) => !columns.includes(c))
  if (missing.length) {
    console.log(`  ${table}: MISSING COLUMNS ${missing.join(', ')}`)
    problems++
  } else {
    console.log(`  ok  ${table} (${found.size} columns)`)
  }
  // Extra columns are not a failure — a later migration may have added one —
  // but they are worth surfacing so drift does not go unnoticed.
  if (extra.length) console.log(`      note: columns the app does not read: ${extra.join(', ')}`)
}

const unknown = [...byTable.keys()].filter((t) => !(t in EXPECTED))
if (unknown.length) console.log(`\n  tables the app does not use: ${unknown.join(', ')}`)

console.log('\ncontents:')
for (const table of Object.keys(EXPECTED)) {
  if (!byTable.has(table)) continue
  const [{ count }] = await sql(`SELECT count(*)::int AS count FROM ${table}`)
  console.log(`  ${table.padEnd(10)} ${String(count).padStart(6)} rows`)
}

const [{ size }] = await sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`
console.log(`\ndatabase size: ${size}`)

if (problems) {
  console.error(`\n${problems} problem(s). Run \`npm run db:setup\`.`)
  process.exit(1)
}
console.log('\nSchema matches the application.')
