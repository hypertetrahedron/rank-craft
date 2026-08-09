/**
 * Shared chart chrome. Colors are CSS custom properties (defined in globals.css)
 * rather than hex literals so light/dark swap in one place — SVG attributes
 * accept var() fine.
 *
 * The palette is validated in both modes against the card surface: worst
 * adjacent CVD ΔE 9.1 light / 8.4 dark, normal-vision 19.6 / 19.3. Three
 * light-mode slots sit below 3:1 contrast on white, so every chart using them
 * carries direct labels and a table view — colour never carries meaning alone.
 */

export const SERIES = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
] as const

/** Assign by entity, in fixed order — never cycled, never by rank. */
export function seriesColor(index: number): string {
  return SERIES[index % SERIES.length]
}

export const GRID = 'var(--grid)'
export const AXIS = 'var(--axis)'
export const MUTED = 'var(--muted-ink)'
export const BAND = 'var(--band)'

export const axisProps = {
  stroke: AXIS,
  tick: { fill: MUTED, fontSize: 11 },
  tickLine: false,
} as const

export const gridProps = {
  stroke: GRID,
  strokeDasharray: '0',
  vertical: false,
} as const

export const tooltipStyle = {
  contentStyle: {
    background: 'rgb(var(--surface-2))',
    border: '1px solid rgb(var(--border))',
    borderRadius: 6,
    fontSize: 12,
    padding: '6px 8px',
  },
  labelStyle: { color: 'rgb(var(--ink-muted))', fontSize: 11, marginBottom: 2 },
  itemStyle: { color: 'rgb(var(--ink))', padding: 0 },
} as const

/** Equal-width bins over a value list, for histograms. */
export function histogram(values: number[], bins = 24): { x: number; count: number }[] {
  if (!values.length) return []
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  if (hi === lo) return [{ x: lo, count: values.length }]
  const width = (hi - lo) / bins
  const counts = new Array(bins).fill(0)
  for (const v of values) {
    counts[Math.min(bins - 1, Math.floor((v - lo) / width))]++
  }
  return counts.map((count, i) => ({ x: lo + (i + 0.5) * width, count }))
}
