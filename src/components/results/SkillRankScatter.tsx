'use client'

import { useMemo } from 'react'
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import { axisProps, gridProps, seriesColor, tooltipStyle } from '@/lib/chartTheme'
import type { SampleTournament } from '@/lib/pyodide/protocol'

/**
 * One tournament, plotted as "where you belonged" against "where you finished".
 * A single series, so no legend; the diagonal is the reference and distance
 * from it is the error. This is the chart that makes an abstract tau concrete.
 */
export function SkillRankScatter({ sample }: { sample: SampleTournament }) {
  const points = useMemo(() => {
    const trueRank = new Map(sample.truth.map((id, i) => [id, i + 1]))
    const finalRank = new Map(sample.final_order.map((id, i) => [id, i + 1]))
    const byId = new Map(sample.field.map((p) => [p.id, p]))
    return sample.truth.map((id) => {
      const p = byId.get(id)!
      const t = trueRank.get(id)!
      const f = finalRank.get(id)!
      return { id, name: p.name, skill: p.skill, score: p.score, trueRank: t, finalRank: f, err: Math.abs(t - f) }
    })
  }, [sample])

  const n = points.length
  const worst = points.reduce((a, b) => (b.err > a.err ? b : a), points[0])

  return (
    <figure className="card p-4">
      <figcaption className="mb-3">
        <h3 className="text-sm font-medium">Where each player belonged, and where they finished</h3>
        <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-ink-muted">
          One representative tournament from the batch. Points on the diagonal finished exactly
          where their true skill said they should; distance from it is the error. Look for the
          shape: errors bunched at the top of the field matter far more than errors in the middle.
        </p>
      </figcaption>

      <div className="h-72">
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: -14 }}>
            <CartesianGrid {...gridProps} vertical />
            <XAxis
              type="number"
              dataKey="trueRank"
              name="true rank"
              domain={[1, n]}
              {...axisProps}
              label={{ value: 'true rank', position: 'insideBottom', offset: -2, fill: 'var(--muted-ink)', fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="finalRank"
              name="finish"
              domain={[1, n]}
              reversed
              width={44}
              {...axisProps}
            />
            <ZAxis range={[42, 42]} />
            <ReferenceLine
              segment={[
                { x: 1, y: 1 },
                { x: n, y: n },
              ]}
              stroke="var(--axis)"
              strokeDasharray="4 4"
            />
            <Tooltip
              {...tooltipStyle}
              cursor={{ strokeDasharray: '3 3', stroke: 'var(--axis)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const p = payload[0].payload as (typeof points)[number]
                return (
                  <div style={tooltipStyle.contentStyle}>
                    <div style={tooltipStyle.labelStyle}>{p.name}</div>
                    <div className="num">
                      true rank {p.trueRank} → finished {p.finalRank}
                    </div>
                    <div className="num text-[11px] opacity-70">
                      skill {p.skill.toFixed(0)} · scored {p.score}
                    </div>
                  </div>
                )
              }}
            />
            <Scatter
              data={points}
              fill={seriesColor(0)}
              fillOpacity={0.85}
              stroke="rgb(var(--surface-2))"
              strokeWidth={2}
              isAnimationActive={false}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {worst && worst.err > 0 && (
        <p className="mt-2 text-xs text-ink-muted">
          Worst placement in this tournament: <span className="font-medium text-ink">{worst.name}</span>{' '}
          belonged at {worst.trueRank} and finished {worst.finalRank}.
        </p>
      )}
    </figure>
  )
}
