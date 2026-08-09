'use client'

import { useEffect } from 'react'

/**
 * Route-level fallback. Individual panels are wrapped in `Boundary`, so
 * reaching this means something outside a panel failed — the wizard shell, the
 * store, or hydration.
 */
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="card max-w-2xl p-6">
      <h1 className="text-base font-semibold text-bad">Something broke</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        Completed runs are stored in this browser and survive a reload, so nothing is lost. If this
        keeps happening, the browser console has the full trace.
      </p>
      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-surface-2 p-3 text-[11px] leading-relaxed">
        {error.message}
      </pre>
      <div className="mt-4 flex gap-2">
        <button className="btn btn-primary" onClick={reset}>
          Try again
        </button>
        <a className="btn" href="/">
          Start over
        </a>
      </div>
    </div>
  )
}
