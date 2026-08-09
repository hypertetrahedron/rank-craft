import { and, eq } from 'drizzle-orm'
import { NO_DB, db, ownerFrom } from '@/lib/db/client'
import { configs } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const conn = db()
  if (!conn) return NO_DB
  const owner = ownerFrom(req)
  if (!owner) return Response.json({ error: 'missing owner id' }, { status: 400 })

  const deleted = await conn
    .delete(configs)
    .where(and(eq(configs.id, params.id), eq(configs.ownerId, owner)))
    .returning({ id: configs.id })

  if (!deleted.length) return Response.json({ error: 'not found' }, { status: 404 })
  return Response.json({ ok: true })
}
