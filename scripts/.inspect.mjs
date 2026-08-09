import { neon } from '@neondatabase/serverless'
const sql = neon(process.env.DATABASE_URL)

for (const t of ['owners', 'functions', 'configs', 'runs']) {
  const rows = await sql(`SELECT * FROM ${t} ORDER BY 1`)
  console.log(`\n${t}: ${rows.length}`)
  for (const r of rows) {
    if (t === 'owners') console.log(`  ${r.id}`)
    else if (t === 'functions') console.log(`  ${r.name} (${r.kind}) owner=${r.owner_id?.slice(0, 8)} v${r.version}`)
    else if (t === 'configs') console.log(`  ${r.name} owner=${r.owner_id?.slice(0, 8)}`)
    else console.log(`  "${r.label}" seed=${r.seed} reps=${r.replications} owner=${r.owner_id?.slice(0, 8)} at ${r.created_at.toISOString?.() ?? r.created_at}`)
  }
}
