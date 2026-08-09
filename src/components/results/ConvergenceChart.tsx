'use client'

import { useMemo, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { axisProps, gridProps, seriesColor, tooltipStyle } from '@/lib/chartTheme'
import { ROUND_META } from '@/lib/metricMeta'
import type { BatchResult, RoundMetric } from '@/lib/pyodide/protocol'
import { summariseByRound, fmt } from '@/lib/stats'

const CURVES: RoundMetric[] = ['tau_vs_true', 'tau_vs_final']

/**
 * Accuracy and settledness per round, with a 95% interval band. Two series, so
 * a legend is present and both lines are direct-labelled at their right end —
 * colour never carries identity on its own.
 */
export function ConvergenceChart({ result }: { result: BatchResult }) {
  const [showTable, setShowTable] = useState(false)

  const { data, rounds } = useMemo(() => {
    const summaries = Object.fromEntries(
      CURVES.map((m) => [m, summariseByRound(result.per_round[m] ?? [])])
    ) as Record<RoundMetric, ReturnType<typeof summariseByRound>>

    const n = Math.max(...CURVES.map((m) => summaries[m].length), 0)
    const rows = Array.from({ length: n }, (_, i) => {
      const row: Record<string, number | null | [number, number]> = { round: i + 1 }
      for (const m of CURVES) {
        const s = summaries[m][i]
        row[m] = s ? s.mean : null
        row[`${m}_band`] = s ? [s.ciLow, s.ciHigh] : null
      }
      return row
    })
    return { data: rows, rounds: n }
  }, [result])

  if (!rounds) return null

  const churn = summariseByRound(result.per_round.churn ?? [])

  // Both curves can finish on the same value (a perfect ranking puts them both
  // at 1.0), which would stack the two direct labels on top of each other.
  // Nudge them apart when that happens.
  const last = data[data.length - 1]
  const ends = CURVES.map((m) => (typeof last?.[m] === 'number' ? (last[m] as number) : null))
  const collide =
    ends[0] !== null && ends[1] !== null && Math.abs((ends[0] as number) - (ends[1] as number)) < 0.04
  const labelOffset = (i: number) => (collide ? (i === 0 ? -6 : 12) : 4)
  const settled = data.findIndex(
    (d) => typeof d.tau_vs_final === 'number' && (d.tau_vs_final as number) >= 0.99
  )

  return (
    <figure className="card p-4">
      <figcaption className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Convergence</h3>
          <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-ink-muted">
            How the standings improved round by round. Where <em>accuracy</em> flattens, extra
            rounds stop buying information; where <em>settledness</em> hits 1.0, the order stopped
            changing at all. Bands are 95% intervals over {result.replication_ids.length.toLocaleString()}{' '}
            replications.
          </p>
        </div>
        <button className="btn shrink-0" onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Chart' : 'Table'}
        </button>
      </figcaption>

      {showTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-ink-muted">
                <th className="py-1.5 pr-3 font-medium">Round</th>
                {CURVES.map((m) => (
                  <th key={m} className="py-1.5 pr-3 font-medium">
                    {ROUND_META[m].label}
                  </th>
                ))}
                <th className="py-1.5 font-medium">{ROUND_META.churn.label}</th>
              </tr>
            </thead>
            <tbody className="num">
              {data.map((row, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="py-1.5 pr-3">{row.round as number}</td>
                  {CURVES.map((m) => (
                    <td key={m} className="py-1.5 pr-3">
                      {fmt(row[m] as number | null, 4)}
                    </td>
                  ))}
                  <td className="py-1.5">{fmt(churn[i]?.mean ?? null, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="h-64">
            <ResponsiveContainer>
              <ComposedChart data={data} margin={{ top: 8, right: 96, bottom: 4, left: -14 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="round" {...axisProps} />
                <YAxis
                  {...axisProps}
                  width={44}
                  domain={[0, 1]}
                  tickFormatter={(v: number) => v.toFixed(1)}
                />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(v: number, name: string) => [
                    fmt(v, 4),
                    ROUND_META[name as RoundMetric]?.label ?? name,
                  ]}
                  labelFormatter={(r: number) => `After round ${r}`}
                />
                {CURVES.map((m, i) => (
                  <Area
                    key={`${m}-band`}
                    dataKey={`${m}_band`}
                    stroke="none"
                    fill={seriesColor(i)}
                    fillOpacity={0.14}
                    isAnimationActive={false}
                    legendType="none"
                    tooltipType="none"
                  />
                ))}
                {CURVES.map((m, i) => (
                  <Line
                    key={m}
                    dataKey={m}
                    type="monotone"
                    stroke={seriesColor(i)}
                    strokeWidth={2}
                    dot={{ r: 3, strokeWidth: 0, fill: seriesColor(i) }}
                    activeDot={{ r: 5, stroke: 'rgb(var(--surface-2))', strokeWidth: 2 }}
                    isAnimationActive={false}
                    label={(props: { index?: number; x?: number; y?: number }) =>
                      props.index === data.length - 1 ? (
                        <text
                          x={(props.x ?? 0) + 8}
                          y={(props.y ?? 0) + labelOffset(i)}
                          fill="rgb(var(--ink))"
                          fontSize={11}
                        >
                          {m === 'tau_vs_true' ? 'accuracy' : 'settledness'}
                        </text>
                      ) : (
                        <g />
                      )
                    }
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 border-t border-border pt-2 text-[11px]">
            {CURVES.map((m, i) => (
              <span key={m} className="flex items-center gap-1.5 text-ink-muted">
                <span
                  className="inline-block h-0.5 w-4 rounded-full"
                  style={{ background: seriesColor(i) }}
                />
                {ROUND_META[m].label}
              </span>
            ))}
          </div>
        </>
      )}

      {settled >= 0 && settled < rounds - 1 && (
        <p className="mt-2 text-xs text-ink-muted">
          The order was effectively settled after round {settled + 1}; the last{' '}
          {rounds - settled - 1} round{rounds - settled - 1 === 1 ? '' : 's'} changed almost
          nothing.
        </p>
      )}
    </figure>
  )
}
