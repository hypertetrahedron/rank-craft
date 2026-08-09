'use client'

import type { BatchResult } from './pyodide/protocol'
import type { SimConfig } from './simConfig'
import { ownerId } from './functionStore'

/**
 * Run and config persistence. Same shape as the function store: hits the API
 * when a database is configured, silently no-ops when one is not, so nothing in
 * the UI has to branch on whether Neon exists.
 */

export type StoredRunSummary = {
  id: string
  label: string
  config: SimConfig
  seed: number
  replications: number
  kendallTau: number | null
  finishedAt: number
}

export type StoredRun = StoredRunSummary & { result: BatchResult }

let available: boolean | null = null

async function call<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (available === false) return null
  try {
    const res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', 'x-owner-id': ownerId(), ...init?.headers },
    })
    if (res.status === 501 || res.status === 404) {
      if (res.status === 501) available = false
      return null
    }
    if (!res.ok) throw new Error(await res.text())
    available = true
    return (await res.json()) as T
  } catch {
    available = false
    return null
  }
}

/** True once a request has confirmed the API is reachable and backed by a DB. */
export function remoteEnabled(): boolean {
  return available === true
}

export async function saveRun(run: {
  label: string
  config: SimConfig
  result: BatchResult
}): Promise<string | null> {
  const res = await call<{ run: { id: string } }>('/api/runs', {
    method: 'POST',
    body: JSON.stringify(run),
  })
  return res?.run.id ?? null
}

export async function listRuns(): Promise<StoredRunSummary[]> {
  const res = await call<{ runs: StoredRunSummary[] }>('/api/runs')
  return res?.runs ?? []
}

/** Full per-replication arrays — needed before a stored run can be paired-tested. */
export async function loadRun(id: string): Promise<StoredRun | null> {
  const res = await call<{ run: StoredRun }>(`/api/runs/${id}`)
  return res?.run ?? null
}

export async function deleteRun(id: string): Promise<void> {
  await call(`/api/runs/${id}`, { method: 'DELETE' })
}

export type StoredConfig = { id: string; name: string; payload: SimConfig; updatedAt: number }

const CONFIG_KEY = 'rankcraft-configs'

function readLocalConfigs(): StoredConfig[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY) || '[]') as StoredConfig[]
  } catch {
    return []
  }
}

function writeLocalConfigs(configs: StoredConfig[]) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(configs))
}

export async function listConfigs(): Promise<StoredConfig[]> {
  const res = await call<{ configs: StoredConfig[] }>('/api/configs')
  return (res?.configs ?? readLocalConfigs()).sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * Falls back to localStorage exactly as saved functions do. Without this, saving
 * a setup with no database configured discarded it while appearing to succeed —
 * the input cleared and the panel closed either way.
 */
export async function saveConfig(name: string, payload: SimConfig, id?: string) {
  const res = await call<{ config: StoredConfig }>('/api/configs', {
    method: 'POST',
    body: JSON.stringify({ name, payload, id }),
  })
  if (res) return res.config

  const record: StoredConfig = {
    id: id ?? crypto.randomUUID(),
    name,
    payload,
    updatedAt: Date.now(),
  }
  writeLocalConfigs([...readLocalConfigs().filter((c) => c.id !== record.id), record])
  return record
}

export async function deleteConfig(id: string): Promise<void> {
  const remote = await call<{ ok: true }>(`/api/configs/${id}`, { method: 'DELETE' })
  if (remote) return
  writeLocalConfigs(readLocalConfigs().filter((c) => c.id !== id))
}

/** Local-only records, for the migration to pick up. */
export function localConfigs(): StoredConfig[] {
  return readLocalConfigs()
}
