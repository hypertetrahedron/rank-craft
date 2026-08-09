'use client'

import { useEffect, useState } from 'react'
import { migrateLocal, scanLocal, type LocalInventory, type MigrationReport } from '@/lib/migrateLocal'
import { probeRemote } from '@/lib/runStore'

/**
 * Offers to move work made before the database existed into it.
 *
 * Only appears when there is something to move *and* somewhere to move it, and
 * says nothing at all otherwise — a persistent "you have unsynced data" notice
 * on a tool that works perfectly well without a database would be noise.
 */
export function MigrationBanner() {
  const [inventory, setInventory] = useState<LocalInventory | null>(null)
  const [state, setState] = useState<'idle' | 'running' | 'done'>('idle')
  const [progress, setProgress] = useState({ done: 0, total: 0, what: '' })
  const [report, setReport] = useState<MigrationReport | null>(null)
  const [hasRemote, setHasRemote] = useState(false)

  useEffect(() => {
    let cancelled = false
    // Both questions have to be asked, and neither answers the other:
    // `scanLocal` never touches the network, so it cannot settle whether a
    // database exists, and a database is no reason to show anything if there is
    // nothing here to move.
    Promise.all([scanLocal(), probeRemote()]).then(([inv, remote]) => {
      if (cancelled) return
      if (inv.total > 0) setInventory(inv)
      setHasRemote(remote)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Once a report exists it stays on screen. A successful migration empties the
  // inventory, so guarding on "is there anything left to send" hid the very
  // message confirming it had been sent — the upload worked and looked as
  // though nothing had happened.
  if (state !== 'done') {
    if (!inventory || inventory.total === 0) return null
    if (state === 'idle' && !hasRemote) return null
  }

  const parts = [
    inventory.functions.length && `${inventory.functions.length} saved function${inventory.functions.length === 1 ? '' : 's'}`,
    inventory.configs.length && `${inventory.configs.length} setup${inventory.configs.length === 1 ? '' : 's'}`,
    inventory.runs.length && `${inventory.runs.length} completed run${inventory.runs.length === 1 ? '' : 's'}`,
  ].filter(Boolean) as string[]

  const run = async () => {
    setState('running')
    try {
      const result = await migrateLocal((done, total, what) => setProgress({ done, total, what }))
      setReport(result)
    } catch (err) {
      // Without this the banner sat on "Uploading…" for ever with nothing to
      // read: an upload that cannot even start is the case most in need of an
      // explanation, not the one least deserving of one.
      setReport({
        uploaded: 0,
        skipped: 0,
        failed: [{ what: 'the upload could not start', why: (err as Error).message }],
      })
    }
    setState('done')
    setInventory(await scanLocal())
  }

  return (
    <div className="rounded-md border border-accent/40 bg-accent-soft/40 p-3">
      {state === 'done' && report ? (
        <div className="text-xs leading-relaxed">
          <p className="text-sm font-medium text-ok">
            {report.uploaded > 0
              ? `Uploaded ${report.uploaded} item${report.uploaded === 1 ? '' : 's'} to the database.`
              : 'Nothing new to upload.'}
          </p>
          <p className="mt-1 text-ink-muted">
            {report.skipped > 0 && `${report.skipped} were already there. `}
            Your local copies are untouched — they are still what the app uses when it cannot
            reach the database.
          </p>
          {report.failed.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-bad">
              {report.failed.slice(0, 5).map((f) => (
                <li key={f.what}>
                  {f.what}: {f.why}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : state === 'running' ? (
        <div className="text-xs">
          <p className="font-medium">Uploading…</p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface">
            <div
              className="h-full bg-accent transition-[width] duration-200"
              style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
            />
          </div>
          <p className="num mt-1.5 text-ink-muted">
            {progress.done} / {progress.total} — {progress.what}
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs leading-relaxed">
            <p className="text-sm font-medium">This browser has work the database does not</p>
            <p className="mt-0.5 text-ink-muted">
              {parts.join(', ')} saved here before a database was configured. Uploading makes them
              available from anywhere; nothing local is deleted.
            </p>
          </div>
          <button className="btn btn-primary shrink-0" onClick={run}>
            Upload {inventory.total}
          </button>
        </div>
      )}
    </div>
  )
}
