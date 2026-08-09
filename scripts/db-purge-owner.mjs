/**
 * Remove everything belonging to one anonymous owner.
 *
 *   node --env-file=.env.local scripts/db-purge-owner.mjs <owner-uuid>
 *
 * Exists because the application has no bulk delete and never should — a
 * browser can only ever remove its own records one at a time. This is the
 * operator's tool for clearing a test identity, and it refuses to run without
 * an explicit owner id so it cannot become an accidental "empty the database".
 */
import { neon } from '@neondatabase/serverless'

const owner = process.argv[2]
if (!owner || !/^[0-9a-f-]{36}$/i.test(owner)) {
  console.error('Usage: node --env-file=.env.local scripts/db-purge-owner.mjs <owner-uuid>')
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Run with --env-file=.env.local')
  process.exit(1)
}

const sql = neon(process.env.DATABASE_URL)

const counts = async (label) => {
  const out = []
  for (const t of ['owners', 'functions', 'configs', 'runs']) {
    const [{ n }] = await sql(`SELECT count(*)::int AS n FROM ${t}`)
    out.push(`${t} ${n}`)
  }
  console.log(`  ${label}: ${out.join(', ')}`)
}

await counts('before')

const f = await sql`DELETE FROM functions WHERE owner_id = ${owner} RETURNING id`
const c = await sql`DELETE FROM configs   WHERE owner_id = ${owner} RETURNING id`
const r = await sql`DELETE FROM runs      WHERE owner_id = ${owner} RETURNING id`
const o = await sql`DELETE FROM owners    WHERE id       = ${owner} RETURNING id`

console.log(
  `  removed: ${f.length} functions, ${c.length} configs, ${r.length} runs, ${o.length} owner`
)
await counts('after')
