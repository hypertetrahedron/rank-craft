import { desc, eq } from 'drizzle-orm'
import { NO_DB, db, ownerFrom } from '@/lib/db/client'
import { owners, runs } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

/** Guard rail: a runaway replication count should not try to write 50 MB of JSON. */
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024

export async function GET(req: Request) {
  const conn = db()
  if (!conn) return NO_DB
  const owner = ownerFrom(req)
  if (!owner) return Response.json({ runs: [] })

  const url = new URL(req.url)
  const full = url.searchParams.get('full') === '1'

  const rows = await conn
    .select()
    .from(runs)
    .where(eq(runs.ownerId, owner))
    .orderBy(desc(runs.createdAt))
    .limit(full ? 12 : 50)

  return Response.json({
    runs: rows.map((r) => ({
      id: r.id,
      label: r.label,
      config: r.config,
      seed: r.seed,
      replications: r.replications,
      kendallTau: r.kendallTau,
      finishedAt: r.createdAt.getTime(),
      // The per-replication arrays are what Compare's paired tests need, but
      // they dominate the response — only sent when asked for.
      result: full ? r.result : undefined,
    })),
  })
}

export async function POST(req: Request) {
  const conn = db()
  if (!conn) return NO_DB
  const owner = ownerFrom(req)
  if (!owner) return Response.json({ error: 'missing owner id' }, { status: 400 })

  const raw = await req.text()
  if (raw.length > MAX_PAYLOAD_BYTES) {
    return Response.json(
      { error: 'run payload too large to store; export it as JSON instead' },
      { status: 413 }
    )
  }
  const body = JSON.parse(raw)
  if (!body.result?.ok || !body.config) {
    return Response.json({ error: 'result and config are required' }, { status: 400 })
  }

  await conn.insert(owners).values({ id: owner }).onConflictDoNothing()

  const taus: (number | null)[] = body.result.final?.kendall_tau ?? []
  const finite = taus.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))

  const [row] = await conn
    .insert(runs)
    .values({
      ownerId: owner,
      label: String(body.label ?? 'Untitled run').slice(0, 200),
      config: body.config,
      result: body.result,
      seed: Number(body.config.seed) || 0,
      replications: body.result.replication_ids?.length ?? 0,
      kendallTau: finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : null,
    })
    .returning()

  return Response.json({ run: { id: row.id, finishedAt: row.createdAt.getTime() } })
}
