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
import { axisProps, gridProps, seriesColor, tooltipStyle } from '@/lib/chartTheme'
import { FINAL_META } from '@/lib/metricMeta'
import type { FinalMetric } from '@/lib/pyodide/protocol'
import { listRuns, loadRun, type StoredRunSummary } from '@/lib/runStore'
import { fmt, pairedTest, summarise, summariseByRound } from '@/lib/stats'
import { useHydratedRuns, useWizard, type RunRecord } from '@/lib/store/wizard'

const COMPARE_METRICS: FinalMetric[] = [
  'kendall_tau',
  'spearman',
  'top1',
  'p_at_3',
  'ndcg_at_10',
  'mean_displacement',
  'rounds_to_95',
]

export function CompareView() {
  const { runs, hydrated } = useHydratedRuns()
  const removeRun = useWizard((s) => s.removeRun)
  const addRun = useWizard((s) => s.addRun)
  const [selected, setSelected] = useState<string[]>([])
  const [metric, setMetric] = useState<FinalMetric>('kendall_tau')
  const [history, setHistory] = useState<StoredRunSummary[]>([])
  const [loading, setLoading] = useState<string | null>(null)

  useEffect(() => {
    listRuns().then(setHistory)
  }, [])

  // Select everything once the cached runs land, without clobbering a later
  // manual deselection.
  const [autoSelected, setAutoSelected] = useState(false)
  useEffect(() => {
    if (!hydrated || autoSelected) return
    setSelected(runs.map((r) => r.id))
    setAutoSelected(true)
  }, [hydrated, autoSelected, runs])

  const loaded = new Set(runs.map((r) => r.label))
  const restorable = history.filter((h) => !loaded.has(h.label))

  const restore = async (id: string) => {
    setLoading(id)
    const full = await loadRun(id)
    if (full) {
      addRun({
        id: `stored-${full.id}`,
        label: full.label,
        config: full.config,
        result: full.result,
        finishedAt: full.finishedAt,
      })
      setSelected((s) => [...s, `stored-${full.id}`])
    }
    setLoading(null)
  }

  const chosen = runs.filter((r) => selected.includes(r.id))
  const baseline = chosen[0]

  const seeds = new Set(chosen.map((r) => r.config.seed))
  const paired = seeds.size === 1 && chosen.length > 1
  const sameField = new Set(chosen.map((r) => `${r.config.players}-${r.config.rounds}`)).size === 1

  const historyList = restorable.length > 0 && (
    <div className="card p-4">
      <div className="label mb-2">Saved runs</div>
      <ul className="space-y-1.5">
        {restorable.map((h) => (
          <li key={h.id} className="flex items-center gap-3 text-sm">
            <span className="flex-1 truncate text-ink-muted">{h.label}</span>
            <span className="num shrink-0 text-xs text-ink-muted">
              τ {h.kendallTau?.toFixed(4) ?? '—'} · seed {h.seed} ·{' '}
              {new Date(h.finishedAt).toLocaleDateString()}
            </span>
            <button
              className="btn shrink-0 py-0.5 text-xs"
              onClick={() => restore(h.id)}
              disabled={loading === h.id}
            >
              {loading === h.id ? 'Loading…' : 'Load'}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-ink-muted">
        Loading pulls the full per-replication data, which is what the paired tests need.
      </p>
    </div>
  )

  if (runs.length === 0) {
    return (
      <div className="space-y-4">
        <div className="card p-6">
          <h1 className="text-base font-semibold">Compare</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-muted">
            Nothing loaded yet. Run at least two configurations — keeping the seed identical between
            them — and they will line up here as a paired comparison.
          </p>
          <Link href="/" className="btn btn-primary mt-4 inline-flex">
            Set up a simulation
          </Link>
        </div>
        {historyList}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-base font-semibold">Compare</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-muted">
          One accuracy number in isolation says very little. Two configurations run on the{' '}
          <em>same seed</em> saw an identical field and identical match luck, replication by
          replication — so their difference is a paired measurement, and a few hundred replications
          can separate strategies that differ by a hundredth of a tau.
        </p>
      </div>

      <div className="card p-4">
        <div className="label mb-2">Runs in this session</div>
        <ul className="space-y-1.5">
          {[...runs].reverse().map((r) => {
            const on = selected.includes(r.id)
            const idx = chosen.findIndex((c) => c.id === r.id)
            return (
              <li key={r.id} className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) =>
                    setSelected((s) =>
                      e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id)
                    )
                  }
                />
                {on && idx >= 0 && (
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: seriesColor(idx) }}
                  />
                )}
                <span className="flex-1 truncate">{r.label}</span>
                <span className="num shrink-0 text-xs text-ink-muted">
                  seed {r.config.seed} · {r.result.replication_ids.length.toLocaleString()} reps
                </span>
                <button
                  className="shrink-0 text-xs text-ink-muted hover:text-bad"
                  onClick={() => removeRun(r.id)}
                >
                  remove
                </button>
              </li>
            )
          })}
        </ul>

        {chosen.length > 1 && !paired && (
          <p className="mt-3 text-xs text-warn">
            These runs used different seeds, so they faced different fields. The comparison below is
            still valid but unpaired — its error bars will be much wider than they need to be. Re-run
            them on a single seed to get the paired version.
          </p>
        )}
        {chosen.length > 1 && !sameField && (
          <p className="mt-1 text-xs text-warn">
            Field size or round count differs between these runs, so the metrics are not on the same
            footing.
          </p>
        )}
      </div>

      {historyList}

      {chosen.length > 0 && (
        <>
          <ComparisonTable runs={chosen} paired={paired} />
          <ConvergenceOverlay runs={chosen} />
          <div className="card p-4">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h3 className="text-sm font-medium">Head to head</h3>
              <select
                className="input w-auto"
                value={metric}
                onChange={(e) => setMetric(e.target.value as FinalMetric)}
              >
                {COMPARE_METRICS.map((m) => (
                  <option key={m} value={m}>
                    {FINAL_META[m].label}
                  </option>
                ))}
              </select>
              <span className="text-xs text-ink-muted">
                against <span className="text-ink">{baseline?.label}</span>
              </span>
            </div>
            <HeadToHead runs={chosen} metric={metric} paired={paired} />
          </div>
        </>
      )}
    </div>
  )
}

function ComparisonTable({ runs, paired }: { runs: RunRecord[]; paired: boolean }) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-medium">Every metric, side by side</h3>
        <p className="mt-0.5 text-xs text-ink-muted">
          Mean ± half the 95% interval. Best in each row is marked.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-ink-muted">
              <th className="px-4 py-2 font-medium">Metric</th>
              {runs.map((r, i) => (
                <th key={r.id} className="px-4 py-2 font-medium">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: seriesColor(i) }}
                    />
                    <span className="max-w-[14rem] truncate text-ink">{r.label}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARE_METRICS.map((m) => {
              const meta = FINAL_META[m]
              const stats = runs.map((r) => summarise(r.result.final[m] ?? []))
              const values = stats.map((s) => s?.mean ?? NaN)
              const finite = values.filter(Number.isFinite)
              const best =
                meta.better === 'none' || !finite.length
                  ? NaN
                  : meta.better === 'high'
                    ? Math.max(...finite)
                    : Math.min(...finite)
              return (
                <tr key={m} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">
                    <div className="font-medium">{meta.label}</div>
                    <div className="text-[11px] text-ink-muted">
                      {meta.better === 'high'
                        ? 'higher is better'
                        : meta.better === 'low'
                          ? 'lower is better'
                          : 'not comparable across configurations'}
                    </div>
                  </td>
                  {stats.map((s, i) => (
                    <td key={i} className="num px-4 py-2">
                      {s ? (
                        <>
                          <span className={s.mean === best ? 'font-semibold text-accent' : ''}>
                            {(meta.format ?? ((v: number) => v.toFixed(meta.digits)))(s.mean)}
                          </span>
                          <span className="ml-1.5 text-[11px] text-ink-muted">
                            ± {((s.ciHigh - s.ciLow) / 2).toFixed(meta.digits)}
                          </span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!paired && (
        <p className="border-t border-border px-4 py-2 text-[11px] text-ink-muted">
          Intervals are unpaired. On a shared seed they would be several times narrower.
        </p>
      )}
    </div>
  )
}

function HeadToHead({
  runs,
  metric,
  paired,
}: {
  runs: RunRecord[]
  metric: FinalMetric
  paired: boolean
}) {
  const meta = FINAL_META[metric]
  const baseline = runs[0]
  const rest = runs.slice(1)

  if (!rest.length) {
    return <p className="text-xs text-ink-muted">Select a second run to test against this one.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-ink-muted">
            <th className="py-2 pr-4 font-medium">Versus {baseline.label}</th>
            <th className="py-2 pr-4 font-medium">Difference</th>
            <th className="py-2 pr-4 font-medium">95% interval</th>
            <th className="py-2 pr-4 font-medium">Wilcoxon z</th>
            <th className="py-2 font-medium">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {rest.map((r, i) => {
            const test = pairedTest(r.result.final[metric] ?? [], baseline.result.final[metric] ?? [])
            if (!test) {
              return (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="py-2 pr-4">{r.label}</td>
                  <td colSpan={4} className="py-2 text-ink-muted">
                    not enough overlapping replications
                  </td>
                </tr>
              )
            }
            const better =
              meta.better === 'high' ? test.meanDiff > 0 : meta.better === 'low' ? test.meanDiff < 0 : null
            return (
              <tr key={r.id} className="border-b border-border last:border-0">
                <td className="py-2 pr-4">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: seriesColor(i + 1) }}
                    />
                    {r.label}
                  </span>
                </td>
                <td className="num py-2 pr-4">
                  {test.meanDiff >= 0 ? '+' : ''}
                  {fmt(test.meanDiff, meta.digits)}
                </td>
                <td className="num py-2 pr-4 text-ink-muted">
                  {fmt(test.ciLow, meta.digits)} – {fmt(test.ciHigh, meta.digits)}
                </td>
                <td className="num py-2 pr-4 text-ink-muted">{fmt(test.wilcoxonZ, 2)}</td>
                <td className="py-2 text-xs">
                  {!test.significant ? (
                    <span className="text-ink-muted">no detectable difference</span>
                  ) : better === null ? (
                    // self-relative metric: a difference is real but not a verdict
                    <span className="text-ink-muted">differs, but not comparable</span>
                  ) : better ? (
                    <span className="text-ok">better{paired ? '' : ' (unpaired)'}</span>
                  ) : (
                    <span className="text-bad">worse{paired ? '' : ' (unpaired)'}</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
        The interval is the one to read. If it straddles zero, the two configurations are not
        distinguishable at this replication count — raise the replications rather than trusting the
        sign of the difference.
      </p>
    </div>
  )
}

function ConvergenceOverlay({ runs }: { runs: RunRecord[] }) {
  const data = useMemo(() => {
    const curves = runs.map((r) => summariseByRound(r.result.per_round.tau_vs_true ?? []))
    const rounds = Math.max(...curves.map((c) => c.length), 0)
    return Array.from({ length: rounds }, (_, i) => {
      const row: Record<string, number | null> = { round: i + 1 }
      runs.forEach((r, k) => {
        row[r.id] = curves[k][i]?.mean ?? null
      })
      return row
    })
  }, [runs])

  if (!data.length) return null

  return (
    <figure className="card p-4">
      <figcaption className="mb-3">
        <h3 className="text-sm font-medium">Accuracy per round</h3>
        <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-ink-muted">
          The shape matters as much as the endpoint. A configuration that reaches its final accuracy
          in four rounds is telling you the last three were ceremony — and one that is still
          climbing at the final round is telling you the tournament was too short.
        </p>
      </figcaption>
      <div className="h-64">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -14 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="round" {...axisProps} />
            <YAxis {...axisProps} width={44} domain={['auto', 1]} tickFormatter={(v: number) => v.toFixed(2)} />
            <Tooltip
              {...tooltipStyle}
              formatter={(v: number, name: string) => [
                fmt(v, 4),
                runs.find((r) => r.id === name)?.label ?? name,
              ]}
              labelFormatter={(r: number) => `After round ${r}`}
            />
            {runs.map((r, i) => (
              <Line
                key={r.id}
                dataKey={r.id}
                type="monotone"
                stroke={seriesColor(i)}
                strokeWidth={2}
                dot={{ r: 3, strokeWidth: 0, fill: seriesColor(i) }}
                activeDot={{ r: 5, stroke: 'rgb(var(--surface-2))', strokeWidth: 2 }}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 border-t border-border pt-2 text-[11px]">
        {runs.map((r, i) => (
          <span key={r.id} className="flex items-center gap-1.5 text-ink-muted">
            <span
              className="inline-block h-0.5 w-4 rounded-full"
              style={{ background: seriesColor(i) }}
            />
            {r.label}
          </span>
        ))}
      </div>
    </figure>
  )
}
