'use client'

import { FINAL_META, HEADLINE_METRICS } from '@/lib/metricMeta'
import type { BatchResult, FinalMetric } from '@/lib/pyodide/protocol'
import { summarise } from '@/lib/stats'

export function MetricCards({ result }: { result: BatchResult }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {HEADLINE_METRICS.map((m) => (
        <MetricCard key={m} metric={m} result={result} />
      ))}
    </div>
  )
}

function MetricCard({ metric, result }: { metric: FinalMetric; result: BatchResult }) {
  const meta = FINAL_META[metric]
  const s = summarise(result.final[metric] ?? [])
  if (!s) return null
  const half = (s.ciHigh - s.ciLow) / 2
  const fmtV = meta.format ?? ((v: number) => v.toFixed(meta.digits))

  return (
    <div className="card p-3">
      <div className="label">{meta.label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl">{fmtV(s.mean)}</span>
        <span className="num text-xs text-ink-muted">
          ± {meta.format ? (half * 100).toFixed(1) + '%' : half.toFixed(meta.digits)}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">{meta.blurb}</p>
    </div>
  )
}

export function MetricTable({ result }: { result: BatchResult }) {
  const rows = (Object.keys(FINAL_META) as FinalMetric[]).map((m) => ({
    metric: m,
    meta: FINAL_META[m],
    s: summarise(result.final[m] ?? []),
  }))

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-medium">Every metric</h3>
        <p className="mt-0.5 text-xs text-ink-muted">
          Mean over {result.replication_ids.length.toLocaleString()} replications, with a 95%
          interval. Narrow intervals mean the difference you are looking at is real.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-ink-muted">
              <th className="px-4 py-2 font-medium">Metric</th>
              <th className="px-4 py-2 font-medium">Mean</th>
              <th className="px-4 py-2 font-medium">95% interval</th>
              <th className="px-4 py-2 font-medium">Range</th>
              <th className="px-4 py-2 font-medium">What it means</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ metric, meta, s }) => (
              <tr key={metric} className="border-b border-border last:border-0 align-top">
                <td className="px-4 py-2 font-medium">{meta.label}</td>
                <td className="num px-4 py-2">{s ? s.mean.toFixed(meta.digits) : '—'}</td>
                <td className="num px-4 py-2 text-ink-muted">
                  {s ? `${s.ciLow.toFixed(meta.digits)} – ${s.ciHigh.toFixed(meta.digits)}` : '—'}
                </td>
                <td className="num px-4 py-2 text-ink-muted">
                  {s ? `${s.min.toFixed(meta.digits)} – ${s.max.toFixed(meta.digits)}` : '—'}
                </td>
                <td className="max-w-md px-4 py-2 text-xs leading-relaxed text-ink-muted">
                  {meta.blurb}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
