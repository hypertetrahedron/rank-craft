'use client'

import { useCallback, useEffect, useState } from 'react'
import { SimPool, CancelledError, defaultPoolSize } from './pool'
import type { PoolStatus } from './pool'
import type { BatchResult } from './protocol'
import type { SimConfig } from '../simConfig'

/**
 * One Pyodide pool shared by the whole page. Booting costs ~10 MB of download
 * and a few seconds, so it is a module singleton rather than per-component
 * state; React just subscribes to its status.
 */
let singleton: SimPool | null = null

export function pool(): SimPool {
  if (!singleton) singleton = new SimPool(defaultPoolSize())
  return singleton
}

export function usePool() {
  const [status, setStatus] = useState<PoolStatus>({ phase: 'idle' })
  const [error, setError] = useState<{ message: string; trace?: string } | null>(null)

  useEffect(() => pool().subscribe(setStatus), [])

  const run = useCallback(async (cfg: SimConfig): Promise<BatchResult | null> => {
    setError(null)
    try {
      return await pool().run(cfg)
    } catch (err) {
      // Cancelling is a user action, not a failure to report.
      if (!(err instanceof CancelledError)) {
        const e = err as Error & { trace?: string }
        setError({ message: e.message, trace: e.trace })
      }
      return null
    }
  }, [])

  /** One 8-player, 3-round tournament — catches contract errors in a second. */
  const smoke = useCallback(
    async (cfg: SimConfig): Promise<{ ok: boolean; error?: string }> => {
      const tiny: SimConfig = {
        ...cfg,
        players: Math.min(cfg.players, 8),
        rounds: Math.min(cfg.rounds, 3),
        replications: 1,
      }
      try {
        await pool().run(tiny, `smoke-${Date.now()}`)
        return { ok: true }
      } catch (err) {
        if (err instanceof CancelledError) return { ok: false, error: 'cancelled' }
        return { ok: false, error: (err as Error).message }
      }
    },
    []
  )

  const cancel = useCallback(() => pool().cancel(), [])

  return { status, error, run, smoke, cancel, size: pool().size }
}
