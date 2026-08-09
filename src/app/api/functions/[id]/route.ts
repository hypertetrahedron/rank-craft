import { and, eq } from 'drizzle-orm'
import { NO_DB, db, ownerFrom } from '@/lib/db/client'
import { functions } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const conn = db()
  if (!conn) return NO_DB

  const owner = ownerFrom(req)
  if (!owner) return Response.json({ error: 'missing owner id' }, { status: 400 })

  // Scoped to the owner: a built-in or someone else's function is not deletable.
  const deleted = await conn
    .delete(functions)
    .where(and(eq(functions.id, params.id), eq(functions.ownerId, owner)))
    .returning({ id: functions.id })

  if (!deleted.length) return Response.json({ error: 'not found' }, { status: 404 })
  return Response.json({ ok: true })
}
