import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'

/**
 * The database is optional. With no DATABASE_URL the API routes answer 501 and
 * the client falls back to localStorage, so the app is fully usable with
 * nothing configured — which is how it runs locally.
 */
let cached: ReturnType<typeof drizzle<typeof schema>> | null = null

export function db() {
  const url = process.env.DATABASE_URL
  if (!url) return null
  if (!cached) cached = drizzle(neon(url), { schema })
  return cached
}

export const NO_DB = Response.json(
  { error: 'No database configured. Saved items live in this browser only.' },
  { status: 501 }
)

/** Anonymous browser id, sent by the client on every request. */
export function ownerFrom(req: Request): string | null {
  const id = req.headers.get('x-owner-id')
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null
}
