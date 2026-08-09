import { desc, eq } from 'drizzle-orm'
import { NO_DB, db, ownerFrom } from '@/lib/db/client'
import { configs, owners } from '@/lib/db/schema'
import { simConfigSchema } from '@/lib/simConfig'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const conn = db()
  if (!conn) return NO_DB
  const owner = ownerFrom(req)
  if (!owner) return Response.json({ configs: [] })

  const rows = await conn
    .select()
    .from(configs)
    .where(eq(configs.ownerId, owner))
    .orderBy(desc(configs.updatedAt))
    .limit(100)

  return Response.json({
    configs: rows.map((r) => ({
      id: r.id,
      name: r.name,
      payload: r.payload,
      updatedAt: r.updatedAt.getTime(),
    })),
  })
}

export async function POST(req: Request) {
  const conn = db()
  if (!conn) return NO_DB
  const owner = ownerFrom(req)
  if (!owner) return Response.json({ error: 'missing owner id' }, { status: 400 })

  const body = await req.json()
  const parsed = simConfigSchema.safeParse(body.payload)
  if (!parsed.success) {
    return Response.json({ error: 'invalid config', issues: parsed.error.issues }, { status: 400 })
  }

  await conn.insert(owners).values({ id: owner }).onConflictDoNothing()

  const values = {
    ownerId: owner,
    name: String(body.name ?? 'Untitled').slice(0, 120),
    payload: parsed.data,
    updatedAt: new Date(),
  }

  // A supplied id is a request to overwrite *if it exists*. The migration
  // always sends the browser's local id for a row the database has never seen,
  // so an update-only path matched nothing, returned no row, and threw on
  // `row.id` — a 500 on the one code path the migration depends on.
  let row
  if (body.id) {
    ;[row] = await conn
      .insert(configs)
      .values({ ...values, id: body.id })
      .onConflictDoUpdate({ target: configs.id, set: values })
      .returning()
  } else {
    ;[row] = await conn.insert(configs).values(values).returning()
  }
  if (!row) return Response.json({ error: 'could not save the config' }, { status: 500 })

  return Response.json({
    config: { id: row.id, name: row.name, payload: row.payload, updatedAt: row.updatedAt.getTime() },
  })
}
