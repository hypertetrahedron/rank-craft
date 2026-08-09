import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { BuiltinFunction } from './builtins.ts'
import { defaultConfig, type FunctionKind } from './simConfig.ts'
import { axisValues, expandSweep, sweepCost } from './sweep.ts'

const fn = (name: string, code = 'def rank_players(t, ctx): pass'): BuiltinFunction => ({
  id: `builtin:ranking:${name}`,
  kind: 'ranking',
  name,
  description: 'x',
  code,
  params: { ridge: { default: 1, min: 0, max: 10 } },
  isBuiltin: true,
})

const library = { ranking: [fn('a'), fn('b'), fn('c')] } as unknown as Record<
  FunctionKind,
  BuiltinFunction[]
>

describe('axisValues', () => {
  it('includes both ends', () => {
    assert.deepEqual(axisValues(0, 10, 3), [0, 5, 10])
    assert.deepEqual(axisValues(2, 2, 4), [2, 2, 2, 2])
  })

  it('collapses to a single value at one step', () => {
    assert.deepEqual(axisValues(5, 100, 1), [5])
  })

  it('handles a descending range', () => {
    assert.deepEqual(axisValues(10, 0, 3), [10, 5, 0])
  })
})

describe('expandSweep', () => {
  const base = defaultConfig()

  it('varies one function and leaves everything else identical', () => {
    const cells = expandSweep(
      base,
      { type: 'function', kind: 'ranking', ids: library.ranking.map((f) => f.id) },
      library
    )
    assert.deepEqual(cells.map((c) => c.label), ['a', 'b', 'c'])
    for (const cell of cells) {
      assert.equal(cell.config.seed, base.seed, 'seed must be shared, or the sweep is unpaired')
      assert.deepEqual(cell.config.functions.pairing, base.functions.pairing)
      assert.equal(cell.config.players, base.players)
    }
    assert.notEqual(cells[0].config.functions.ranking.name, cells[1].config.functions.ranking.name)
  })

  it('seeds each function with its own declared parameter defaults', () => {
    const cells = expandSweep(base, { type: 'function', kind: 'ranking', ids: [fn('a').id] }, library)
    assert.deepEqual(cells[0].config.functions.ranking.params, { ridge: 1 })
  })

  it('ignores ids that are not in the library', () => {
    const cells = expandSweep(base, { type: 'function', kind: 'ranking', ids: ['nope'] }, library)
    assert.equal(cells.length, 0)
  })

  it('varies a function parameter without touching the code', () => {
    const cells = expandSweep(
      base,
      { type: 'param', kind: 'ranking', name: 'ridge', from: 0.5, to: 2.5, steps: 3 },
      library
    )
    assert.deepEqual(cells.map((c) => c.config.functions.ranking.params.ridge), [0.5, 1.5, 2.5])
    for (const c of cells) assert.equal(c.config.functions.ranking.code, base.functions.ranking.code)
  })

  it('varies a field quantity as an integer', () => {
    const cells = expandSweep(base, { type: 'field', name: 'rounds', from: 3, to: 8, steps: 4 }, library)
    assert.deepEqual(cells.map((c) => c.config.rounds), [3, 5, 6, 8])
    for (const c of cells) assert.ok(Number.isInteger(c.config.rounds))
  })

  it('varies a nested world-model knob without clobbering its siblings', () => {
    const cells = expandSweep(
      base,
      { type: 'model', name: 'matchup.amplitude', from: 0, to: 300, steps: 4 },
      library
    )
    assert.deepEqual(cells.map((c) => c.config.matchup.amplitude), [0, 100, 200, 300])
    for (const c of cells) {
      assert.equal(c.config.matchup.archetypes, base.matchup.archetypes)
      assert.equal(c.config.matchup.kind, base.matchup.kind)
      assert.equal(c.config.variance.max_up, base.variance.max_up)
    }
  })

  it('never mutates the base configuration', () => {
    const snapshot = JSON.stringify(base)
    expandSweep(base, { type: 'model', name: 'fatigue.amplitude', from: 0, to: 50, steps: 3 }, library)
    expandSweep(base, { type: 'field', name: 'players', from: 8, to: 64, steps: 3 }, library)
    assert.equal(JSON.stringify(base), snapshot)
  })
})

describe('sweepCost', () => {
  it('adds up the matches across cells', () => {
    const base = { ...defaultConfig(), players: 32, rounds: 6, replications: 100 }
    const cells = expandSweep(
      base,
      { type: 'field', name: 'rounds', from: 4, to: 6, steps: 2 },
      library
    )
    // 16 matches a round: 4 rounds and 6 rounds, 100 replications each
    assert.equal(sweepCost(cells), 16 * 4 * 100 + 16 * 6 * 100)
  })
})
