'use client'

import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { axisProps, gridProps, seriesColor, tooltipStyle } from '@/lib/chartTheme'
import type { BatchResult } from '@/lib/pyodide/protocol'

/**
 * Distribution of mean rank error across replications. A tight cluster means
 * the strategy is reliable; a long right tail means it usually works and
 * occasionally produces a mess — which the mean alone hides.
 */
export function DisplacementHistogram({ result }: { result: BatchResult }) {
  const values = useMemo(
    () => (result.final.mean_displacement ?? []).filter((v): v is number => v !== null),
    [result]
  )

  const { bins, mean, p95, degenerate } = useMemo(() => {
    if (!values.length) return { bins: [], mean: 0, p95: 0, degenerate: false }
    const lo = Math.min(...values)
    const hi = Math.max(...values)
    const sorted = [...values].sort((a, b) => a - b)
    const stats = {
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      p95: sorted[Math.floor(sorted.length * 0.95)],
    }

    // A perfect (or perfectly consistent) strategy puts every replication on
    // the same value. Spreading that across 20 empty bins reads as a broken
    // chart, so collapse it to the one bin that exists.
    if (hi === lo) {
      return { bins: [{ x: lo, n: values.length, lo, hi: lo }], ...stats, degenerate: true }
    }

    // Never more bins than distinct values, or the chart grows comb teeth.
    const count = Math.min(20, new Set(values).size)
    const width = (hi - lo) / count
    const buckets = new Array(count).fill(0)
    for (const v of values) buckets[Math.min(count - 1, Math.floor((v - lo) / width))]++
    return {
      bins: buckets.map((n, i) => ({
        x: lo + (i + 0.5) * width,
        n,
        lo: lo + i * width,
        hi: lo + (i + 1) * width,
      })),
      ...stats,
      degenerate: false,
    }
  }, [values])

  if (!bins.length) return null

  return (
    <figure className="card p-4">
      <figcaption className="mb-3">
        <h3 className="text-sm font-medium">How reliable is it?</h3>
        <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-ink-muted">
          {degenerate ? (
            <>
              Every one of the {values.length.toLocaleString()} replications produced the same mean
              rank error of {mean.toFixed(2)}. There is no spread to plot — this configuration
              behaves identically every time.
            </>
          ) : (
            <>
              Mean rank error across all {values.length.toLocaleString()} replications. A tight
              cluster means the strategy behaves the same way every time; a long tail to the right
              means it usually works and occasionally produces a mess. Bars past the 95th percentile
              are highlighted — that tail is what a single unlucky tournament looks like.
            </>
          )}
        </p>
      </figcaption>

      <div className="h-48">
        <ResponsiveContainer>
          <BarChart data={bins} margin={{ top: 4, right: 8, bottom: 4, left: -18 }}>
            <CartesianGrid {...gridProps} />
            <XAxis
              dataKey="x"
              type="number"
              domain={degenerate ? [mean - 1, mean + 1] : ['dataMin', 'dataMax']}
              {...axisProps}
              tickFormatter={(v: number) => v.toFixed(1)}
              interval="preserveStartEnd"
            />
            <YAxis {...axisProps} width={38} />
            <Tooltip
              {...tooltipStyle}
              cursor={{ fill: 'var(--grid)', fillOpacity: 0.4 }}
              formatter={(v: number) => [`${v} replications`, '']}
              labelFormatter={(x: number) => `mean error ≈ ${Number(x).toFixed(2)} places`}
            />
            <Bar dataKey="n" radius={[3, 3, 0, 0]}>
              {bins.map((b, i) => (
                <Cell key={i} fill={b.lo >= p95 ? seriesColor(1) : seriesColor(0)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <dl className="mt-2 flex gap-6 border-t border-border pt-2 text-xs">
        <div>
          <dt className="text-ink-muted">Typical</dt>
          <dd className="num">{mean.toFixed(2)} places off</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Bad day (95th pct)</dt>
          <dd className="num">{p95.toFixed(2)} places off</dd>
        </div>
      </dl>
    </figure>
  )
}
