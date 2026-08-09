import { and, desc, eq, isNull, or } from 'drizzle-orm'
import { NO_DB, db, ownerFrom } from '@/lib/db/client'
import { functions, owners } from '@/lib/db/schema'
import { FUNCTION_KINDS } from '@/lib/simConfig'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const conn = db()
  if (!conn) return NO_DB

  const owner = ownerFrom(req)
  const kind = new URL(req.url).searchParams.get('kind')
  if (kind && !FUNCTION_KINDS.includes(kind as (typeof FUNCTION_KINDS)[number])) {
    return Response.json({ error: `unknown kind ${kind}` }, { status: 400 })
  }

  // Your own functions plus the shared library; never anyone else's private ones.
  const visible = owner
    ? or(eq(functions.ownerId, owner), eq(functions.isBuiltin, true))
    : or(isNull(functions.ownerId), eq(functions.isBuiltin, true))

  const rows = await conn
    .select()
    .from(functions)
    .where(kind ? and(visible, eq(functions.kind, kind)) : visible)
    .orderBy(desc(functions.updatedAt))
    .limit(500)

  return Response.json({
    functions: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      description: r.description,
      code: r.code,
      params: r.params,
      version: r.version,
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
  if (!FUNCTION_KINDS.includes(body.kind)) {
    return Response.json({ error: 'unknown kind' }, { status: 400 })
  }
  if (typeof body.code !== 'string' || !body.code.trim()) {
    return Response.json({ error: 'code is required' }, { status: 400 })
  }
  if (typeof body.name !== 'string' || !body.name.trim()) {
    return Response.json({ error: 'name is required' }, { status: 400 })
  }

  await conn.insert(owners).values({ id: owner }).onConflictDoNothing()

  const values = {
    ownerId: owner,
    kind: body.kind,
    name: body.name.trim().slice(0, 120),
    description: String(body.description ?? '').slice(0, 500),
    code: body.code,
    params: body.params ?? {},
    isBuiltin: false,
    updatedAt: new Date(),
  }

  // Saving over an existing id keeps the id stable so configs referencing it
  // still resolve, and bumps the version.
  const existing = body.id
    ? await conn.select().from(functions).where(eq(functions.id, body.id)).limit(1)
    : []

  let row
  if (existing.length && existing[0].ownerId === owner) {
    ;[row] = await conn
      .update(functions)
      .set({ ...values, version: existing[0].version + 1 })
      .where(eq(functions.id, body.id))
      .returning()
  } else {
    ;[row] = await conn
      .insert(functions)
      .values(body.id ? { ...values, id: body.id } : values)
      .returning()
  }

  return Response.json({
    function: {
      id: row.id,
      kind: row.kind,
      name: row.name,
      description: row.description,
      code: row.code,
      params: row.params,
      version: row.version,
      updatedAt: row.updatedAt.getTime(),
    },
  })
}
