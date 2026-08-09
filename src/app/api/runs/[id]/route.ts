import { and, eq } from 'drizzle-orm'
import { NO_DB, db, ownerFrom } from '@/lib/db/client'
import { runs } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const conn = db()
  if (!conn) return NO_DB
  const owner = ownerFrom(req)
  if (!owner) return Response.json({ error: 'missing owner id' }, { status: 400 })

  const [row] = await conn
    .select()
    .from(runs)
    .where(and(eq(runs.id, params.id), eq(runs.ownerId, owner)))
    .limit(1)

  if (!row) return Response.json({ error: 'not found' }, { status: 404 })
  return Response.json({
    run: {
      id: row.id,
      label: row.label,
      config: row.config,
      result: row.result,
      finishedAt: row.createdAt.getTime(),
    },
  })
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const conn = db()
  if (!conn) return NO_DB
  const owner = ownerFrom(req)
  if (!owner) return Response.json({ error: 'missing owner id' }, { status: 400 })

  const deleted = await conn
    .delete(runs)
    .where(and(eq(runs.id, params.id), eq(runs.ownerId, owner)))
    .returning({ id: runs.id })

  if (!deleted.length) return Response.json({ error: 'not found' }, { status: 404 })
  return Response.json({ ok: true })
}
