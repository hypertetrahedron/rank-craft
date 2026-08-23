import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { mergeSlices, partition, requiredWheels } from './pool.ts'
import { FAIRNESS_METRICS, FINAL_METRICS, ROUND_METRICS, WHEELS } from './protocol.ts'
import type { BatchResult } from './protocol.ts'
import { splitBuiltins } from '../builtins.ts'
import { simConfigSchema, type SimConfig } from '../simConfig.ts'

const config = (code: Partial<Record<string, string>> = {}): SimConfig =>
  simConfigSchema.parse({
    functions: {
      seeding: { code: code.seeding ?? 'def seed_order(p, ctx): pass' },
      pairing: { code: code.pairing ?? 'def pair_round(t, ctx): pass' },
      outcome: { code: code.outcome ?? 'def play_match(a, b, ctx): pass' },
      rating: { code: code.rating ?? 'def update_ratings(t, r, ctx): pass' },
      ranking: { code: code.ranking ?? 'def rank_players(t, ctx): pass' },
    },
    skill: {},
    variance: {},
    initial_rating: {},
  })

/** A slice carrying one replication's worth of recognisable values. */
const slice = (ids: number[]): BatchResult => ({
  ok: true,
  version: '1.0.0',
  replication_ids: ids,
  final: Object.fromEntries(
    FINAL_METRICS.map((m) => [m, ids.map((i) => i)])
  ) as BatchResult['final'],
  fairness: Object.fromEntries(
    FAIRNESS_METRICS.map((m) => [m, ids.map((i) => i * 10)])
  ) as BatchResult['fairness'],
  per_round: Object.fromEntries(
    ROUND_METRICS.map((m) => [m, ids.map((i) => [i, i])])
  ) as BatchResult['per_round'],
  sample: null,
})

describe('partition', () => {
  it('covers every replication exactly once, in order', () => {
    for (const [total, workers] of [
      [200, 8],
      [7, 3],
      [1, 8],
      [0, 4],
      [100, 1],
      [13, 13],
    ]) {
      const slices = partition(total, workers)
      assert.equal(slices.length, workers, `${total}/${workers}: wrong slice count`)
      const flat = slices.flat()
      assert.deepEqual(
        flat,
        Array.from({ length: total }, (_, i) => i),
        `${total}/${workers}: not a contiguous cover`
      )
    }
  })

  it('balances slices to within one replication', () => {
    const sizes = partition(200, 7).map((s) => s.length)
    assert.equal(Math.max(...sizes) - Math.min(...sizes) <= 1, true)
    assert.equal(
      sizes.reduce((a, b) => a + b, 0),
      200
    )
  })

  it('keeps slices contiguous, so concatenation reproduces a single-worker run', () => {
    // This is what makes pool size a performance knob rather than a
    // correctness one — see the determinism assertion in py-selftest.
    for (const s of partition(50, 6)) {
      for (let i = 1; i < s.length; i++) assert.equal(s[i], s[i - 1] + 1)
    }
  })

  it('gives the extra replications to the earliest workers', () => {
    assert.deepEqual(partition(5, 3), [[0, 1], [2, 3], [4]])
  })
})

describe('mergeSlices', () => {
  it('concatenates in slice order', () => {
    const merged = mergeSlices([slice([0, 1, 2]), slice([3, 4]), slice([5])])
    assert.deepEqual(merged.replication_ids, [0, 1, 2, 3, 4, 5])
    assert.deepEqual(merged.final.kendall_tau, [0, 1, 2, 3, 4, 5])
    assert.deepEqual(merged.fairness.repeat_pairings, [0, 10, 20, 30, 40, 50])
    assert.equal(merged.per_round.tau_vs_true.length, 6)
    assert.deepEqual(merged.per_round.tau_vs_true[3], [3, 3])
  })

  it('tolerates empty slices from workers with no work', () => {
    const merged = mergeSlices([slice([0]), slice([]), slice([1])])
    assert.deepEqual(merged.replication_ids, [0, 1])
    assert.deepEqual(merged.final.top1, [0, 1])
  })

  it('takes the sample from the first slice that has one', () => {
    const withSample = { ...slice([0]), sample: { marker: 1 } as never }
    assert.ok(mergeSlices([slice([]), withSample, slice([1])]).sample)
    assert.equal(mergeSlices([slice([0]), slice([1])]).sample, null)
  })

  it('produces every declared metric key even from nothing', () => {
    const merged = mergeSlices([])
    for (const m of FINAL_METRICS) assert.deepEqual(merged.final[m], [])
    for (const m of FAIRNESS_METRICS) assert.deepEqual(merged.fairness[m], [])
    for (const m of ROUND_METRICS) assert.deepEqual(merged.per_round[m], [])
  })
})

describe('requiredWheels', () => {
  it('loads nothing when no function needs a package', () => {
    assert.deepEqual(requiredWheels(config()), [])
  })

  it('detects numpy by import', () => {
    const wheels = requiredWheels(config({ ranking: 'import numpy as np\ndef rank_players(t, ctx): pass' }))
    assert.equal(wheels.length, 1)
    assert.match(wheels[0], /numpy/)
  })

  it('detects networkx through the max_weight_pairing helper', () => {
    // Users never import networkx directly; the harness helper does it for them.
    const wheels = requiredWheels(config({ pairing: 'def pair_round(t, ctx):\n  return max_weight_pairing(...)' }))
    assert.equal(wheels.length, 1)
    assert.match(wheels[0], /networkx/)
  })

  it('detects numpy through the helpers that import it', () => {
    // ridge_margin is exactly this case: it calls ridge_ratings and never
    // writes `numpy`, so scanning for the module name alone left the wheel
    // unloaded and the run died on ModuleNotFoundError inside the harness.
    for (const helper of ['ridge_ratings', 'posterior_spread']) {
      const wheels = requiredWheels(config({ ranking: 'def rank_players(t, ctx):\n  return ' + helper + '(t)' }))
      assert.equal(wheels.length, 1, helper)
      assert.match(wheels[0], /numpy/)
    }
  })

  it('loads numpy for the shipped built-ins that reach it through a helper', () => {
    const source = readFileSync(path.join(process.cwd(), 'public', 'py', 'builtins', 'ranking.py'), 'utf8')
    for (const b of splitBuiltins('ranking', source)) {
      if (!b.code.includes('ridge_ratings')) continue
      assert.ok(
        requiredWheels(config({ ranking: b.code })).some((u) => u.includes('numpy')),
        b.name + ' needs numpy but no wheel would be loaded'
      )
    }
  })

  it('loads both when both are needed, across different hooks', () => {
    assert.equal(
      requiredWheels(
        config({
          pairing: 'max_weight_pairing',
          ranking: 'import numpy',
        })
      ).length,
      2
    )
  })

  it('lists every injected harness helper that imports a wheel', () => {
    // The guard against this drifting again: a new helper in harness.py that
    // imports numpy is invisible to requiredWheels until it is named in
    // WHEELS[].helpers, and the failure only shows up at run time.
    const harness = readFileSync(path.join(process.cwd(), 'public', 'py', 'harness.py'), 'utf8')
    const bodies: Record<string, string[]> = {}
    let current = ''
    for (const line of harness.split('\n')) {
      if (line.startsWith('def ')) current = line.slice(4, line.indexOf('('))
      else if (line.trim() !== '' && !line.startsWith(' ')) current = ''
      if (current) (bodies[current] ??= []).push(line.trim())
    }
    for (const w of WHEELS) {
      for (const [name, body] of Object.entries(bodies)) {
        // Only what load_hook injects is reachable from user code.
        if (!harness.includes("'" + name + "': " + name + ",")) continue
        if (!body.some((l) => l.startsWith('import ' + w.module))) continue
        assert.ok(
          w.helpers.includes(name),
          'harness.' + name + ' imports ' + w.module + ' - add it to WHEELS[].helpers in protocol.ts'
        )
      }
    }
  })
})
