/** Aggregation for per-replication metric arrays: intervals and paired tests. */

export type Summary = {
  n: number
  mean: number
  sd: number
  se: number
  ciLow: number
  ciHigh: number
  min: number
  max: number
  median: number
}

const clean = (xs: (number | null)[]): number[] =>
  xs.filter((v): v is number => v !== null && Number.isFinite(v))

/** Two-sided 95% Student-t critical values, df 1..30; normal beyond. */
const T95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145,
  2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048,
  2.045, 2.042,
]

export function tCrit95(df: number): number {
  if (df < 1) return NaN
  return df <= 30 ? T95[df - 1] : 1.96
}

export function summarise(values: (number | null)[]): Summary | null {
  const xs = clean(values)
  const n = xs.length
  if (n === 0) return null
  const mean = xs.reduce((a, b) => a + b, 0) / n
  const sd = n < 2 ? 0 : Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1))
  const se = n < 2 ? 0 : sd / Math.sqrt(n)
  const half = n < 2 ? 0 : tCrit95(n - 1) * se
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(n / 2)
  return {
    n,
    mean,
    sd,
    se,
    ciLow: mean - half,
    ciHigh: mean + half,
    min: sorted[0],
    max: sorted[n - 1],
    median: n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
  }
}

/** Column-wise summary of a [replication][round] matrix. */
export function summariseByRound(matrix: (number | null)[][]): (Summary | null)[] {
  const rounds = matrix.reduce((m, row) => Math.max(m, row.length), 0)
  return Array.from({ length: rounds }, (_, r) => summarise(matrix.map((row) => row[r] ?? null)))
}

// --------------------------------------------------------------------------
// paired comparison
//
// Two configs run under common random numbers share their field and their match
// luck replication by replication, so the difference is paired. Testing the
// differences rather than the two means is what makes a few hundred
// replications enough to separate strategies that differ by ~0.01 tau.
// --------------------------------------------------------------------------

export type PairedTest = {
  n: number
  meanDiff: number
  ciLow: number
  ciHigh: number
  t: number
  pApprox: number
  wilcoxonZ: number
  significant: boolean
}

export function pairedTest(a: (number | null)[], b: (number | null)[]): PairedTest | null {
  const diffs: number[] = []
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]
    const y = b[i]
    if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) continue
    diffs.push(x - y)
  }
  const n = diffs.length
  if (n < 2) return null

  const mean = diffs.reduce((s, d) => s + d, 0) / n
  const sd = Math.sqrt(diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / (n - 1))
  const se = sd / Math.sqrt(n)
  const t = se === 0 ? (mean === 0 ? 0 : Infinity) : mean / se
  const half = tCrit95(n - 1) * se

  return {
    n,
    meanDiff: mean,
    ciLow: mean - half,
    ciHigh: mean + half,
    t,
    pApprox: twoSidedNormalP(t),
    wilcoxonZ: wilcoxonSignedRankZ(diffs),
    significant: Math.abs(t) >= tCrit95(n - 1),
  }
}

/** Normal approximation to the two-sided p-value. Adequate at n > 30, which a
 *  replication count always is; below that read the CI instead. */
export function twoSidedNormalP(z: number): number {
  if (!Number.isFinite(z)) return 0
  return 2 * (1 - normalCdf(Math.abs(z)))
}

export function normalCdf(x: number): number {
  // Abramowitz & Stegun 7.1.26 applied to erf
  const t = 1 / (1 + 0.3275911 * (Math.abs(x) / Math.SQRT2))
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(x * x) / 2)
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y)
}

/**
 * Wilcoxon signed-rank, normal approximation with tie correction. Robust to the
 * heavy tails a metric like max_displacement produces.
 *
 * `w` here is the *signed* rank sum (W+ − W−), not W+. Its null variance is
 * therefore 4·Var(W+) = n(n+1)(2n+1)/6 − Σ(t³−t)/12. The tie term is easy to
 * get wrong — it is /12 for this form and /48 for W+ — so `stats.test.ts`
 * checks it against exact enumeration of the null distribution rather than
 * against a remembered formula.
 */
export function wilcoxonSignedRankZ(diffs: number[]): number {
  const nz = diffs.filter((d) => d !== 0)
  const n = nz.length
  if (n < 2) return NaN

  const byAbs = nz.map((d) => ({ abs: Math.abs(d), sign: Math.sign(d) })).sort((x, y) => x.abs - y.abs)
  const ranks = new Array<number>(n)
  let tieCorrection = 0
  let i = 0
  while (i < n) {
    let j = i
    while (j + 1 < n && byAbs[j + 1].abs === byAbs[i].abs) j++
    const avg = (i + j) / 2 + 1
    const t = j - i + 1
    tieCorrection += t ** 3 - t
    for (let k = i; k <= j; k++) ranks[k] = avg
    i = j + 1
  }

  const w = byAbs.reduce((s, d, k) => s + d.sign * ranks[k], 0)
  const varW = (n * (n + 1) * (2 * n + 1)) / 6 - tieCorrection / 12
  return varW <= 0 ? NaN : w / Math.sqrt(varW)
}

// --------------------------------------------------------------------------
// formatting
// --------------------------------------------------------------------------

export function fmt(v: number | null | undefined, digits = 3): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return v.toFixed(digits)
}

export function fmtCI(s: Summary | null, digits = 3): string {
  if (!s) return '—'
  return `${s.mean.toFixed(digits)} ± ${((s.ciHigh - s.ciLow) / 2).toFixed(digits)}`
}
