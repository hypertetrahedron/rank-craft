'use client'

import type { FunctionKind } from './simConfig'
import type { ParamSpec } from './builtins'

/**
 * Saved user functions.
 *
 * Talks to /api/functions when a database is configured, and transparently
 * falls back to localStorage when it is not — so the app is fully usable with
 * no DATABASE_URL. Identity is an anonymous browser id, not an account.
 */

export type SavedFunction = {
  id: string
  kind: FunctionKind
  name: string
  description: string
  code: string
  params: Record<string, ParamSpec>
  updatedAt: number
  /** Bumped every time this function is saved over. A run recorded against
   *  version 3 did not necessarily run the code you are looking at now. */
  version?: number
  isBuiltin?: false
}

const OWNER_KEY = 'rankcraft-owner'
const LOCAL_KEY = 'rankcraft-functions'

export function ownerId(): string {
  if (typeof window === 'undefined') return 'server'
  let id = localStorage.getItem(OWNER_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(OWNER_KEY, id)
  }
  return id
}

let remoteAvailable: boolean | null = null

async function tryRemote<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (remoteAvailable === false) return null
  try {
    const res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', 'x-owner-id': ownerId(), ...init?.headers },
    })
    if (res.status === 501) {
      remoteAvailable = false
      return null
    }
    if (!res.ok) throw new Error(await res.text())
    remoteAvailable = true
    return (await res.json()) as T
  } catch {
    remoteAvailable = false
    return null
  }
}

function readLocal(): SavedFunction[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]') as SavedFunction[]
  } catch {
    return []
  }
}

function writeLocal(fns: SavedFunction[]) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(fns))
}

export async function listFunctions(kind?: FunctionKind): Promise<SavedFunction[]> {
  const remote = await tryRemote<{ functions: SavedFunction[] }>(
    `/api/functions${kind ? `?kind=${kind}` : ''}`
  )
  const all = remote ? remote.functions : readLocal()
  return all
    .filter((f) => !kind || f.kind === kind)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveFunction(
  fn: Omit<SavedFunction, 'id' | 'updatedAt'> & { id?: string }
): Promise<SavedFunction> {
  const record: SavedFunction = {
    ...fn,
    id: fn.id ?? crypto.randomUUID(),
    updatedAt: Date.now(),
  }
  const remote = await tryRemote<{ function: SavedFunction }>('/api/functions', {
    method: 'POST',
    body: JSON.stringify(record),
  })
  if (remote) return remote.function

  const previous = readLocal().find((f) => f.id === record.id)
  const versioned = { ...record, version: (previous?.version ?? 0) + 1 }
  writeLocal([...readLocal().filter((f) => f.id !== record.id), versioned])
  return versioned
}

export async function deleteFunction(id: string): Promise<void> {
  const remote = await tryRemote<{ ok: true }>(`/api/functions/${id}`, { method: 'DELETE' })
  if (remote) return
  writeLocal(readLocal().filter((f) => f.id !== id))
}

/** True when saved functions live only in this browser. Surfaced in the UI. */
export function isLocalOnly(): boolean {
  return remoteAvailable === false
}
