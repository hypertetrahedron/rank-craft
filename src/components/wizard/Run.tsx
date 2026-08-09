'use client'

import { useEffect, useState } from 'react'
import { usePool } from '@/lib/pyodide/usePool'
import { deleteRun, listRuns, loadRun, remoteEnabled, saveRun, type StoredRunSummary } from '@/lib/runStore'
import { matchCount } from '@/lib/simConfig'
import { useHydratedRuns, useWizard } from '@/lib/store/wizard'
import { Intro } from './Field'
import { NumberField } from './controls'

export function StepRun() {
  const cfg = useWizard((s) => s.config)
  const patch = useWizard((s) => s.patch)
  const addRun = useWizard((s) => s.addRun)
  const setStep = useWizard((s) => s.setStep)
  const { runs } = useHydratedRuns()
  const { status, error, run, cancel, size } = usePool()
  const [label, setLabel] = useState('')
  const [history, setHistory] = useState<StoredRunSummary[]>([])
  const [loadingId, setLoadingId] = useState<string | null>(null)

  useEffect(() => {
    listRuns().then(setHistory)
  }, [])

  const restore = async (id: string) => {
    setLoadingId(id)
    const full = await loadRun(id)
    if (full) {
      addRun({
        id: `stored-${full.id}`,
        label: full.label,
        config: full.config,
        result: full.result,
        finishedAt: full.finishedAt,
      })
      setStep(6)
    }
    setLoadingId(null)
  }

  const busy = status.phase === 'running' || status.phase === 'booting'
  const matches = matchCount(cfg)

  const start = async () => {
    const started = Date.now()
    const chosenLabel = label.trim() || describe(cfg)
    const result = await run(cfg)
    if (!result) return
    addRun({
      id: `run-${started}`,
      label: chosenLabel,
      config: structuredClone(cfg),
      result,
      finishedAt: Date.now(),
    })
    setLabel('')
    setStep(6)
    // Fire and forget: a storage failure must not cost the user their results,
    // which are already in memory and on the results page.
    void saveRun({ label: chosenLabel, config: cfg, result })
  }

  return (
    <div className="space-y-6">
      <Intro
        title="Run it"
        body="Everything runs in your browser: real CPython compiled to WebAssembly, spread across worker threads. Nothing leaves the machine and there is no server round-trip."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <NumberField
          label="Replications"
          value={cfg.replications}
          min={1}
          max={20000}
          step={50}
          onChange={(replications) => patch({ replications })}
        />
        <div className="card p-3">
          <div className="label">Matches to simulate</div>
          <p className="num mt-1 text-2xl">{matches.toLocaleString()}</p>
        </div>
        <div className="card p-3">
          <div className="label">Workers</div>
          <p className="num mt-1 text-2xl">{size}</p>
          <p className="mt-1 text-[11px] text-ink-muted">
            Slices are contiguous, so the result is the same at any worker count.
          </p>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            className="input max-w-xs flex-1"
            placeholder={describe(cfg)}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={busy}
          />
          {busy ? (
            <button className="btn" onClick={cancel}>
              Cancel
            </button>
          ) : (
            <button className="btn btn-primary" onClick={start}>
              Run simulation
            </button>
          )}
        </div>

        <div className="mt-3">
          {status.phase === 'booting' && (
            <p className="text-xs text-ink-muted">{status.detail}…</p>
          )}
          {status.phase === 'running' && (
            <>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full bg-accent transition-[width] duration-200"
                  style={{ width: `${(status.done / Math.max(1, status.total)) * 100}%` }}
                />
              </div>
              <p className="num mt-1.5 text-xs text-ink-muted">
                {status.done.toLocaleString()} / {status.total.toLocaleString()} replications
              </p>
            </>
          )}
          {status.phase === 'ready' && !busy && (
            <p className="text-xs text-ink-muted">Engine warm. Subsequent runs start instantly.</p>
          )}
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-bad/40 bg-bad/5 p-3">
            <p className="text-xs font-medium text-bad">The simulation stopped</p>
            <pre className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-bad">
              {error.message}
            </pre>
            {error.trace && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[11px] text-ink-muted">Traceback</summary>
                <pre className="mt-1 whitespace-pre-wrap text-[10.5px] leading-relaxed text-ink-muted">
                  {error.trace}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>

      {history.length > 0 && (
        <div className="card p-4">
          <div className="label mb-2">Saved runs</div>
          <ul className="divide-y divide-border text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex items-center gap-3 py-2">
                <span className="flex-1 truncate">{h.label}</span>
                <span className="num shrink-0 text-xs text-ink-muted">
                  τ {h.kendallTau?.toFixed(4) ?? '—'} · seed {h.seed} ·{' '}
                  {new Date(h.finishedAt).toLocaleDateString()}
                </span>
                <button
                  className="btn shrink-0 py-0.5 text-xs"
                  onClick={() => restore(h.id)}
                  disabled={loadingId === h.id}
                >
                  {loadingId === h.id ? 'Loading…' : 'Open'}
                </button>
                <button
                  className="shrink-0 text-xs text-ink-muted hover:text-bad"
                  onClick={async () => {
                    await deleteRun(h.id)
                    setHistory(await listRuns())
                  }}
                >
                  delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {runs.length > 0 && (
        <div className="card p-4">
          <div className="label mb-2">This session</div>
          <ul className="divide-y divide-border text-sm">
            {[...runs].reverse().map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                <span className="truncate">{r.label}</span>
                <span className="num shrink-0 text-xs text-ink-muted">
                  {r.result.replication_ids.length.toLocaleString()} reps
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-ink-muted">
            Runs from this session are what the Compare view lines up side by side. Keep the seed
            fixed between them and the comparison becomes a paired one.
            {remoteEnabled()
              ? ' They are also saved to the database and can be reloaded from Compare later.'
              : ' No database is configured, so these live in memory until you reload the page — export anything you want to keep.'}
          </p>
        </div>
      )}
    </div>
  )
}

function describe(cfg: { functions: Record<string, { name: string }>; players: number; rounds: number }) {
  return `${cfg.functions.pairing.name} + ${cfg.functions.ranking.name} · ${cfg.players}p × ${cfg.rounds}r`
}
