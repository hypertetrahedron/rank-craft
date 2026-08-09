'use client'

import type { RunRecord } from './wizard'

/**
 * Local persistence for completed runs.
 *
 * These are too large for localStorage — a 500-replication run is a few hundred
 * KB of raw per-replication arrays, and the whole point of keeping them raw is
 * that Compare's paired tests need the individual replications. IndexedDB has
 * no practical size ceiling, so runs survive a refresh even with no database
 * configured.
 */

const DB_NAME = 'rankcraft'
const STORE = 'runs'
const KEEP = 8

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('finishedAt', 'finishedAt')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  })
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null)
        const store = db.transaction(STORE, mode).objectStore(STORE)
        const req = fn(store)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(null)
      })
  )
}

export async function cacheRun(run: RunRecord): Promise<void> {
  // structuredClone strips anything IndexedDB cannot serialise and detaches the
  // record from React state.
  await tx('readwrite', (s) => s.put(structuredClone(run)))
  await prune()
}

export async function cachedRuns(): Promise<RunRecord[]> {
  const all = (await tx<RunRecord[]>('readonly', (s) => s.getAll())) ?? []
  return all.sort((a, b) => a.finishedAt - b.finishedAt)
}

export async function uncacheRun(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id))
}

async function prune() {
  const all = await cachedRuns()
  for (const stale of all.slice(0, Math.max(0, all.length - KEEP))) {
    await uncacheRun(stale.id)
  }
}
