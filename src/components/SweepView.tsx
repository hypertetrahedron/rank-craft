'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Boundary } from '@/components/Boundary'
import { axisProps, gridProps, seriesColor, tooltipStyle } from '@/lib/chartTheme'
import { loadBuiltins } from '@/lib/builtins'
import type { BuiltinFunction } from '@/lib/builtins'
import { FINAL_META } from '@/lib/metricMeta'
import type { BatchResult, FinalMetric } from '@/lib/pyodide/protocol'
import { usePool } from '@/lib/pyodide/usePool'
import { FUNCTION_KINDS } from '@/lib/simConfig'
import type { FunctionKind } from '@/lib/simConfig'
import { fmt, pairedTest, summarise } from '@/lib/stats'
import { MODEL_KNOBS, expandSweep, sweepCost, type SweepAxis, type SweepCell } from '@/lib/sweep'
import { useWizard } from '@/lib/store/wizard'
import { NumberField, Segmented } from '@/components/wizard/controls'

type Row = { label: string; result: BatchResult }

const SHOWN: FinalMetric[] = [
  'kendall_tau',
  'top1',
  'p_at_2',
  'p_at_8',
  'true_second_place',
  'top8_displacement',
]

/**
 * Runs a list of configurations that differ in exactly one place and lays the
 * answers out side by side. Everything here was previously only reachable by
 * dropping to `scripts/bench.mjs` — which is a strange gap in a tool whose
 * entire premise is experimentation.
 */
export function SweepView() {
  const config = useWizard((s) => s.config)
  const addRun = useWizard((s) => s.addRun)
  const { status, error, run, cancel } = usePool()

  const [library, setLibrary] = useState<Record<FunctionKind, BuiltinFunction[]> | null>(null)
  const [mode, setMode] = useState<'function' | 'param' | 'field' | 'model'>('function')
  const [kind, setKind] = useState<FunctionKind>('ranking')
  const [selected, setSelected] = useState<string[]>([])
  const [paramName, setParamName] = useState('')
  const [fieldName, setFieldName] = useState<'rounds' | 'players' | 'top_cut'>('rounds')
  const [knob, setKnob] = useState(MODEL_KNOBS[0].value)
  const [range, setRange] = useState({ from: 0, to: 300, steps: 5 })
  const [replications, setReplications] = useState(config.replications)
  const [rows, setRows] = useState<Row[]>([])
  const [busyCell, setBusyCell] = useState<string | null>(null)

  useEffect(() => {
    loadBuiltins().then(setLibrary)
  }, [])

  // Default to comparing every built-in of the chosen kind — the most useful
  // starting point, and the one that takes no setup.
  useEffect(() => {
    if (library) setSelected(library[kind].map((f) => f.id))
  }, [library, kind])

  const paramOptions = useMemo(
    () => Object.keys(config.functions[kind].params ?? {}),
    [config.functions, kind]
  )
  useEffect(() => {
    if (paramOptions.length && !paramOptions.includes(paramName)) setParamName(paramOptions[0])
  }, [paramOptions, paramName])

  const axis: SweepAxis | null = useMemo(() => {
    if (mode === 'function') return { type: 'function', kind, ids: selected }
    if (mode === 'param') {
      if (!paramName) return null
      return { type: 'param', kind, name: paramName, ...range }
    }
    if (mode === 'field') return { type: 'field', name: fieldName, ...range }
    return { type: 'model', name: knob, ...range }
  }, [mode, kind, selected, paramName, fieldName, knob, range])

  const cells: SweepCell[] = useMemo(() => {
    if (!axis || !library) return []
    const base = { ...config, replications }
    return expandSweep(base, axis, library)
  }, [axis, library, config, replications])

  const cost = sweepCost(cells)
  const busy = status.phase === 'running' || status.phase === 'booting' || busyCell !== null

  const start = async () => {
    setRows([])
    for (const cell of cells) {
      setBusyCell(cell.label)
      const result = await run(cell.config)
      if (!result) break // cancelled or failed
      setRows((prev) => [...prev, { label: cell.label, result }])
    }
    setBusyCell(null)
  }

  const baseline = rows[0]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-base font-semibold">Sweep</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-muted">
          Run a row of configurations that differ in exactly one place. Every cell shares the seed
          from your current setup, so the whole sweep is one paired sample — the differences you
          see are differences in the strategy, not in the dice.
        </p>
      </div>

      <div className="card space-y-4 p-4">
        <Segmented
          label="Vary"
          value={mode}
          onChange={(m) => setMode(m)}
          options={[
            { value: 'function', label: 'A function', hint: 'Compare strategies of one kind' },
            { value: 'param', label: 'A parameter', hint: 'A knob inside the selected function' },
            { value: 'field', label: 'The field', hint: 'Rounds, players, or cut size' },
            { value: 'model', label: 'The world', hint: 'Randomness, matchups, fatigue…' },
          ]}
        />

        {(mode === 'function' || mode === 'param') && (
          <Segmented
            label="Which hook"
            value={kind}
            onChange={(k) => setKind(k)}
            options={FUNCTION_KINDS.map((k) => ({ value: k, label: k }))}
          />
        )}

        {mode === 'function' && library && (
          <div>
            <div className="label mb-1.5">Functions to compare</div>
            <div className="flex flex-wrap gap-1.5">
              {library[kind].map((f) => {
                const on = selected.includes(f.id)
                return (
                  <button
                    key={f.id}
                    title={f.description}
                    onClick={() =>
                      setSelected((s) => (on ? s.filter((x) => x !== f.id) : [...s, f.id]))
                    }
                    className={`rounded-md border px-2 py-1 font-mono text-xs ${
                      on ? 'border-accent bg-accent text-accent-ink' : 'border-border hover:bg-surface'
                    }`}
                  >
                    {f.name}
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-[11px] text-ink-muted">
              {selected.length} selected. The first is the baseline every other row is tested
              against.
            </p>
          </div>
        )}

        {mode === 'param' && (
          <div>
            <div className="label mb-1.5">Parameter</div>
            {paramOptions.length ? (
              <Segmented
                value={paramName}
                onChange={setParamName}
                options={paramOptions.map((p) => ({ value: p, label: p }))}
              />
            ) : (
              <p className="text-xs text-ink-muted">
                The selected {kind} function declares no parameters. Pick a function with a{' '}
                <code className="font-mono">PARAMS</code> block, or sweep something else.
              </p>
            )}
          </div>
        )}

        {mode === 'field' && (
          <Segmented
            label="Quantity"
            value={fieldName}
            onChange={(f) => setFieldName(f)}
            options={[
              { value: 'rounds', label: 'Rounds' },
              { value: 'players', label: 'Players' },
              { value: 'top_cut', label: 'Top cut' },
            ]}
          />
        )}

        {mode === 'model' && (
          <Segmented
            label="Knob"
            value={knob}
            onChange={(k) => setKnob(k)}
            options={MODEL_KNOBS.map((k) => ({ value: k.value, label: k.label, hint: k.hint }))}
          />
        )}

        {mode !== 'function' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField label="From" value={range.from} step={1} onChange={(from) => setRange({ ...range, from })} />
            <NumberField label="To" value={range.to} step={1} onChange={(to) => setRange({ ...range, to })} />
            <NumberField
              label="Steps"
              value={range.steps}
              min={1}
              max={20}
              onChange={(steps) => setRange({ ...range, steps })}
            />
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField
            label="Replications per cell"
            value={replications}
            min={1}
            max={5000}
            step={25}
            onChange={setReplications}
            hint="Paired, so a few hundred is usually plenty"
          />
          <div className="card p-3">
            <div className="label">Cells</div>
            <p className="num mt-1 text-2xl">{cells.length}</p>
          </div>
          <div className="card p-3">
            <div className="label">Matches</div>
            <p className="num mt-1 text-2xl">{cost.toLocaleString()}</p>
            {cost > 20_000_000 && (
              <p className="mt-1 text-[11px] text-warn">Long run — reduce replications first.</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {busy ? (
            <button className="btn" onClick={cancel}>
              Cancel
            </button>
          ) : (
            <button className="btn btn-primary" onClick={start} disabled={cells.length < 2}>
              Run {cells.length} configurations
            </button>
          )}
          {busyCell && (
            <span className="text-xs text-ink-muted">
              running <span className="font-mono">{busyCell}</span> — {rows.length}/{cells.length}{' '}
              done
              {status.phase === 'running' &&
                ` · ${status.done}/${status.total} replications in this cell`}
            </span>
          )}
          {status.phase === 'booting' && <span className="text-xs text-ink-muted">{status.detail}…</span>}
        </div>

        {error && (
          <pre className="whitespace-pre-wrap rounded-md border border-bad/40 bg-bad/5 p-3 text-[11px] leading-relaxed text-bad">
            {error.message}
          </pre>
        )}
      </div>

      {rows.length > 0 && (
        <>
          <Boundary label="The sweep table">
            <SweepTable rows={rows} baseline={baseline} />
          </Boundary>
          {rows.length > 1 && (
            <Boundary label="The sweep chart">
              <SweepChart rows={rows} />
            </Boundary>
          )}
          <div className="flex flex-wrap gap-2">
            {rows.map((r) => (
              <button
                key={r.label}
                className="btn"
                onClick={() =>
                  addRun({
                    id: `sweep-${Date.now()}-${r.label}`,
                    label: r.label,
                    config: cells.find((c) => c.label === r.label)?.config ?? config,
                    result: r.result,
                    finishedAt: Date.now(),
                  })
                }
              >
                Keep &ldquo;{r.label}&rdquo;
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-muted">
            Keeping a cell puts it in <Link href="/compare" className="text-accent">Compare</Link>,
            where you can run the full paired tests and see its convergence curve.
          </p>
        </>
      )}
    </div>
  )
}

function SweepTable({ rows, baseline }: { rows: Row[]; baseline?: Row }) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">Results</h2>
        <p className="mt-0.5 text-xs text-ink-muted">
          Every cell ran the same field and the same match luck. The τ difference is paired against{' '}
          <span className="font-mono">{baseline?.label}</span>; an interval straddling zero means
          the two are not distinguishable at this replication count.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-ink-muted">
              <th className="px-4 py-2 font-medium">Configuration</th>
              {SHOWN.map((m) => (
                <th key={m} className="px-4 py-2 text-right font-medium">
                  {FINAL_META[m].label}
                </th>
              ))}
              <th className="px-4 py-2 text-right font-medium">vs baseline (τ)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const test =
                baseline && r !== baseline
                  ? pairedTest(r.result.final.kendall_tau, baseline.result.final.kendall_tau)
                  : null
              return (
                <tr key={r.label} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-mono text-xs">{r.label}</td>
                  {SHOWN.map((m) => {
                    const s = summarise(r.result.final[m] ?? [])
                    const meta = FINAL_META[m]
                    return (
                      <td key={m} className="num px-4 py-2 text-right">
                        {s ? (meta.format ?? ((v: number) => v.toFixed(meta.digits)))(s.mean) : '—'}
                      </td>
                    )
                  })}
                  <td className="num px-4 py-2 text-right">
                    {!test ? (
                      <span className="text-ink-muted">baseline</span>
                    ) : (
                      <span
                        className={
                          !test.significant
                            ? 'text-ink-muted'
                            : test.meanDiff > 0
                              ? 'text-ok'
                              : 'text-bad'
                        }
                      >
                        {test.meanDiff >= 0 ? '+' : ''}
                        {fmt(test.meanDiff, 4)} ± {fmt((test.ciHigh - test.ciLow) / 2, 4)}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SweepChart({ rows }: { rows: Row[] }) {
  const data = rows.map((r) => {
    const s = summarise(r.result.final.kendall_tau)
    return { label: r.label, tau: s?.mean ?? null, lo: s?.ciLow ?? null, hi: s?.ciHigh ?? null }
  })

  return (
    <figure className="card p-4">
      <figcaption className="mb-3">
        <h2 className="text-sm font-medium">Accuracy across the sweep</h2>
        <p className="mt-0.5 text-xs text-ink-muted">
          Kendall τ per configuration, in the order they were run.
        </p>
      </figcaption>
      <div className="h-64">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: -14 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="label" {...axisProps} interval={0} angle={-20} textAnchor="end" height={60} />
            <YAxis {...axisProps} width={48} domain={['auto', 'auto']} tickFormatter={(v: number) => v.toFixed(2)} />
            <Tooltip {...tooltipStyle} formatter={(v: number) => [fmt(v, 4), 'Kendall τ']} />
            <Line
              dataKey="tau"
              type="monotone"
              stroke={seriesColor(0)}
              strokeWidth={2}
              dot={{ r: 3, strokeWidth: 0, fill: seriesColor(0) }}
              activeDot={{ r: 5, stroke: 'rgb(var(--surface-2))', strokeWidth: 2 }}
              isAnimationActive={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}
