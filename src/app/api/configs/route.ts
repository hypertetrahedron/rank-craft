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

  const [row] = body.id
    ? await conn.update(configs).set(values).where(eq(configs.id, body.id)).returning()
    : await conn.insert(configs).values(values).returning()

  return Response.json({
    config: { id: row.id, name: row.name, payload: row.payload, updatedAt: row.updatedAt.getTime() },
  })
}
