import { neon } from '@neondatabase/serverless'
const sql = neon(process.env.DATABASE_URL)

const fns = await sql`SELECT owner_id, name, kind FROM functions ORDER BY name`
const cfgs = await sql`SELECT owner_id, name FROM configs ORDER BY name`
const runs = await sql`SELECT owner_id, label, seed FROM runs ORDER BY label`
const owners = await sql`SELECT id, created_at FROM owners ORDER BY created_at`

console.log(`owners (${owners.length}):`)
owners.forEach((o) => console.log(`  ${o.id}`))
console.log(`\nfunctions (${fns.length}):`)
fns.forEach((f) => console.log(`  "${f.name}" (${f.kind})`))
console.log(`\nconfigs (${cfgs.length}):`)
cfgs.forEach((c) => console.log(`  "${c.name}"`))
console.log(`\nruns (${runs.length}):`)
runs.forEach((r) => console.log(`  "${r.label}" seed=${r.seed}`))
