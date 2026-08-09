import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  fmt,
  fmtCI,
  normalCdf,
  pairedTest,
  summarise,
  summariseByRound,
  tCrit95,
  twoSidedNormalP,
  wilcoxonSignedRankZ,
} from './stats.ts'

const close = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !== ${b} (within ${eps})`)

describe('summarise', () => {
  it('computes mean, sd and a t-interval', () => {
    const s = summarise([2, 4, 4, 4, 5, 5, 7, 9])!
    close(s.mean, 5)
    close(s.sd, Math.sqrt(32 / 7)) // sample sd, n-1 denominator
    close(s.se, s.sd / Math.sqrt(8))
    close(s.ciHigh - s.mean, tCrit95(7) * s.se)
    close(s.median, 4.5)
    assert.equal(s.min, 2)
    assert.equal(s.max, 9)
    assert.equal(s.n, 8)
  })

  it('drops nulls and non-finite values rather than propagating them', () => {
    const s = summarise([1, null, 2, NaN, 3, Infinity])!
    assert.equal(s.n, 3)
    close(s.mean, 2)
  })

  it('returns null when there is nothing to summarise', () => {
    assert.equal(summarise([]), null)
    assert.equal(summarise([null, null]), null)
  })

  it('reports a zero-width interval for a single value', () => {
    const s = summarise([7])!
    close(s.mean, 7)
    close(s.ciLow, 7)
    close(s.ciHigh, 7)
  })
})

describe('summariseByRound', () => {
  it('summarises down columns of a [replication][round] matrix', () => {
    const out = summariseByRound([
      [1, 2, 3],
      [3, 4, 5],
    ])
    assert.equal(out.length, 3)
    close(out[0]!.mean, 2)
    close(out[2]!.mean, 4)
  })

  it('tolerates ragged rows', () => {
    const out = summariseByRound([[1, 2, 3], [5]])
    assert.equal(out.length, 3)
    close(out[0]!.mean, 3)
    close(out[1]!.mean, 2)
    assert.equal(out[1]!.n, 1)
  })
})

describe('normalCdf', () => {
  it('matches known values of the standard normal', () => {
    close(normalCdf(0), 0.5, 1e-7)
    close(normalCdf(1.959963985), 0.975, 1e-6)
    close(normalCdf(-1.959963985), 0.025, 1e-6)
    close(normalCdf(1), 0.8413447461, 1e-6)
    close(normalCdf(-2.5), 0.0062096653, 1e-6)
  })

  it('is symmetric', () => {
    for (const x of [0.3, 1.1, 2.7, 4]) close(normalCdf(x) + normalCdf(-x), 1, 1e-9)
  })
})

describe('twoSidedNormalP', () => {
  it('gives the conventional p-values', () => {
    close(twoSidedNormalP(1.959963985), 0.05, 1e-6)
    close(twoSidedNormalP(0), 1, 1e-7)
    assert.ok(twoSidedNormalP(6) < 1e-6)
  })
})

describe('wilcoxonSignedRankZ', () => {
  /**
   * Exact null variance of the signed-rank sum, by enumerating all 2^n sign
   * patterns. This is the check that matters: the tie-correction term is easy
   * to get wrong by a constant factor, and a wrong constant still produces
   * plausible-looking output. Comparing against a brute-forced null
   * distribution catches it; comparing against a remembered formula does not.
   */
  const exactVar = (abs: number[]) => {
    const n = abs.length
    const idx = [...abs.keys()].sort((a, b) => abs[a] - abs[b])
    const ranks = new Array<number>(n)
    let i = 0
    while (i < n) {
      let j = i
      while (j + 1 < n && abs[idx[j + 1]] === abs[idx[i]]) j++
      const avg = (i + j) / 2 + 1
      for (let k = i; k <= j; k++) ranks[idx[k]] = avg
      i = j + 1
    }
    let sum = 0
    let sumSq = 0
    for (let m = 0; m < 1 << n; m++) {
      let w = 0
      for (let k = 0; k < n; k++) w += ((m >> k) & 1 ? 1 : -1) * ranks[k]
      sum += w
      sumSq += w * w
    }
    const N = 1 << n
    return sumSq / N - (sum / N) ** 2
  }

  /** Recover the variance the implementation used, from a known rank sum. */
  const impliedVar = (signed: number[]) => {
    const z = wilcoxonSignedRankZ(signed)
    const abs = signed.map(Math.abs)
    const n = abs.length
    const idx = [...abs.keys()].sort((a, b) => abs[a] - abs[b])
    const ranks = new Array<number>(n)
    let i = 0
    while (i < n) {
      let j = i
      while (j + 1 < n && abs[idx[j + 1]] === abs[idx[i]]) j++
      const avg = (i + j) / 2 + 1
      for (let k = i; k <= j; k++) ranks[idx[k]] = avg
      i = j + 1
    }
    const w = signed.reduce((s, d, k) => s + Math.sign(d) * ranks[k], 0)
    return (w / z) ** 2
  }

  const cases: [string, number[]][] = [
    ['no ties', [1, 2, 3, 4, 5, 6, 7, 8]],
    ['some ties', [1, 1, 2, 2, 3, 4, 5, 5]],
    ['heavy ties', [1, 1, 1, 1, 2, 2, 2, 2]],
    ['mixed run lengths', [1, 1, 1, 2, 2, 3, 3, 3, 4, 4]],
  ]

  for (const [name, abs] of cases) {
    it(`uses the exact null variance — ${name}`, () => {
      // all-positive differences: the rank sum is then the full rank total,
      // which makes the implied variance recoverable from z
      const signed = abs.map((a) => a)
      close(impliedVar(signed), exactVar(abs), 1e-6)
    })
  }

  it('is zero when the differences are symmetric', () => {
    close(wilcoxonSignedRankZ([1, -1, 2, -2, 3, -3]), 0, 1e-12)
  })

  it('ignores exact zeros', () => {
    close(wilcoxonSignedRankZ([1, 2, 3, 0, 0]), wilcoxonSignedRankZ([1, 2, 3]), 1e-12)
  })

  it('is NaN when there is nothing to test', () => {
    assert.ok(Number.isNaN(wilcoxonSignedRankZ([])))
    assert.ok(Number.isNaN(wilcoxonSignedRankZ([5])))
    assert.ok(Number.isNaN(wilcoxonSignedRankZ([0, 0, 0])))
  })

  it('has the sign of the shift', () => {
    assert.ok(wilcoxonSignedRankZ([1, 2, 3, 4, 5]) > 0)
    assert.ok(wilcoxonSignedRankZ([-1, -2, -3, -4, -5]) < 0)
  })
})

describe('pairedTest', () => {
  it('tests the differences, not the two means', () => {
    // Wildly different levels, perfectly consistent +1 difference: the paired
    // test must see a certain effect where an unpaired one would see noise.
    const a = [10, 50, 90, 30, 70, 20, 60, 40]
    const b = a.map((x) => x - 1)
    const t = pairedTest(a, b)!
    close(t.meanDiff, 1)
    assert.equal(t.n, 8)
    assert.ok(t.significant)
    close(t.ciLow, 1)
    close(t.ciHigh, 1)
  })

  it('skips replications where either side is missing', () => {
    const t = pairedTest([1, null, 3, 4], [0, 1, null, 3])!
    assert.equal(t.n, 2) // only indices 0 and 3 line up
    close(t.meanDiff, 1)
  })

  it('reports no significance when the interval straddles zero', () => {
    const t = pairedTest([1, -1, 2, -2, 1, -1, 2, -2], [0, 0, 0, 0, 0, 0, 0, 0])!
    assert.ok(!t.significant)
    assert.ok(t.ciLow < 0 && t.ciHigh > 0)
  })

  it('returns null when fewer than two pairs line up', () => {
    assert.equal(pairedTest([1], [0]), null)
    assert.equal(pairedTest([], []), null)
    assert.equal(pairedTest([1, null], [0, 2]), null)
  })

  it('handles a zero-variance difference without dividing by zero', () => {
    const t = pairedTest([5, 5, 5], [5, 5, 5])!
    close(t.meanDiff, 0)
    assert.equal(t.t, 0)
    assert.ok(!t.significant)
  })
})

describe('tCrit95', () => {
  it('matches the table at small df and the normal beyond it', () => {
    close(tCrit95(1), 12.706)
    close(tCrit95(10), 2.228)
    close(tCrit95(30), 2.042)
    close(tCrit95(31), 1.96)
    close(tCrit95(5000), 1.96)
  })

  it('is NaN below one degree of freedom', () => {
    assert.ok(Number.isNaN(tCrit95(0)))
  })
})

describe('formatting', () => {
  it('renders an em dash for anything unmeasurable', () => {
    assert.equal(fmt(null), '—')
    assert.equal(fmt(undefined), '—')
    assert.equal(fmt(NaN), '—')
    assert.equal(fmt(Infinity), '—')
    assert.equal(fmtCI(null), '—')
  })

  it('renders half the interval width, not the bounds', () => {
    assert.equal(fmt(0.12345, 3), '0.123')
    assert.equal(fmtCI(summarise([1, 2, 3]), 2), '2.00 ± 2.48')
  })
})
