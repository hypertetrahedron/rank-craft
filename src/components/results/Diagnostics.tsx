'use client'

import { FAIRNESS_META } from '@/lib/metricMeta'
import type { BatchResult, FairnessMetric } from '@/lib/pyodide/protocol'
import { summarise } from '@/lib/stats'

/**
 * Fairness sits beside accuracy on purpose. A pairing system that recovers the
 * true order by handing out rematches and lopsided colours has not solved the
 * problem — it has moved the cost somewhere the accuracy metric cannot see.
 */
export function Diagnostics({ result }: { result: BatchResult }) {
  const rows = (Object.keys(FAIRNESS_META) as FairnessMetric[]).map((m) => ({
    metric: m,
    meta: FAIRNESS_META[m],
    s: summarise(result.fairness[m] ?? []),
  }))

  const repeats = summarise(result.fairness.repeat_pairings ?? [])
  const colour = summarise(result.fairness.max_color_imbalance ?? [])

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-medium">Tournament health</h3>
        <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-ink-muted">
          What the pairing cost in fairness. Accuracy bought with rematches or lopsided colours is
          not accuracy an arbiter could actually ship.
        </p>
      </div>

      {(repeats && repeats.mean > 0.05) || (colour && colour.mean > 2) ? (
        <div className="border-b border-border bg-warn/5 px-4 py-2 text-xs text-warn">
          {repeats && repeats.mean > 0.05 && (
            <p>
              This pairing produces {repeats.mean.toFixed(2)} rematches per tournament. Swiss rules
              forbid rematches — raise the repeat penalty, or treat the accuracy figure as an upper
              bound that a legal pairing could not reach.
            </p>
          )}
          {colour && colour.mean > 2 && (
            <p>
              Worst colour imbalance averages {colour.mean.toFixed(1)}. Above 2 draws a protest in a
              real event.
            </p>
          )}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-ink-muted">
              <th className="px-4 py-2 font-medium">Measure</th>
              <th className="px-4 py-2 font-medium">Mean</th>
              <th className="px-4 py-2 font-medium">Worst seen</th>
              <th className="px-4 py-2 font-medium">What it means</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ metric, meta, s }) => (
              <tr key={metric} className="border-b border-border align-top last:border-0">
                <td className="px-4 py-2 font-medium">{meta.label}</td>
                <td className="num px-4 py-2">{s ? s.mean.toFixed(meta.digits) : '—'}</td>
                <td className="num px-4 py-2 text-ink-muted">
                  {s ? s.max.toFixed(meta.digits) : '—'}
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
