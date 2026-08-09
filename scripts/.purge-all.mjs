/**
 * One-off: clear the test data written while bringing the database up.
 * Prints what it is about to delete so the decision is visible, not implicit.
 */
import { neon } from '@neondatabase/serverless'
const sql = neon(process.env.DATABASE_URL)

const owners = await sql`SELECT id FROM owners`
console.log(`purging ${owners.length} anonymous owners and everything they own`)

for (const { id } of owners) {
  const f = await sql`DELETE FROM functions WHERE owner_id = ${id} RETURNING id`
  const c = await sql`DELETE FROM configs   WHERE owner_id = ${id} RETURNING id`
  const r = await sql`DELETE FROM runs      WHERE owner_id = ${id} RETURNING id`
  await sql`DELETE FROM owners WHERE id = ${id}`
  console.log(`  ${id.slice(0, 8)}: ${f.length} functions, ${c.length} configs, ${r.length} runs`)
}

// Anything left would be a row with no owner, which nothing in the app creates.
for (const t of ['owners', 'functions', 'configs', 'runs']) {
  const [{ n }] = await sql(`SELECT count(*)::int AS n FROM ${t}`)
  console.log(`  ${t} remaining: ${n}`)
}
