import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { planMigration, runKey } from './migrateLocal.ts'
import type { LocalInventory } from './migrateLocal.ts'

const fn = (id: string, name = id) =>
  ({ id, kind: 'ranking', name, description: '', code: 'x', params: {}, updatedAt: 1 }) as never

const cfg = (id: string, name = id) => ({ id, name, payload: {}, updatedAt: 1 }) as never

const run = (id: string, label: string, seed = 1) =>
  ({ id, label, config: { seed }, result: {}, finishedAt: 1 }) as never

const inventory = (over: Partial<Omit<LocalInventory, 'total'>> = {}) => ({
  functions: [],
  configs: [],
  runs: [],
  ...over,
})

describe('planMigration', () => {
  it('sends everything when nothing has been migrated', () => {
    const plan = planMigration(
      inventory({ functions: [fn('f1')], configs: [cfg('c1')], runs: [run('r1', 'first')] }),
      new Set(),
      new Set()
    )
    assert.equal(plan.functions.length, 1)
    assert.equal(plan.configs.length, 1)
    assert.equal(plan.runs.length, 1)
    assert.equal(plan.duplicateRuns.length, 0)
  })

  it('skips anything already uploaded', () => {
    const plan = planMigration(
      inventory({ functions: [fn('f1'), fn('f2')], configs: [cfg('c1')], runs: [run('r1', 'a')] }),
      new Set(['f1', 'c1', 'r1']),
      new Set()
    )
    assert.deepEqual(plan.functions.map((f) => f.id), ['f2'])
    assert.equal(plan.configs.length, 0)
    assert.equal(plan.runs.length, 0)
  })

  it('does not re-send a run the database already holds', () => {
    // Runs insert rather than upsert, so this is the check that stops the
    // migration duplicating a user's results.
    const plan = planMigration(
      inventory({ runs: [run('r1', 'burstein run', 7), run('r2', 'monrad run', 7)] }),
      new Set(),
      new Set(['burstein run|7'])
    )
    assert.deepEqual(plan.runs.map((r) => r.label), ['monrad run'])
    assert.deepEqual(plan.duplicateRuns.map((r) => r.label), ['burstein run'])
  })

  it('sends only one of two identical local runs', () => {
    const plan = planMigration(
      inventory({ runs: [run('r1', 'same', 3), run('r2', 'same', 3)] }),
      new Set(),
      new Set()
    )
    assert.equal(plan.runs.length, 1)
    assert.equal(plan.duplicateRuns.length, 1)
  })

  it('treats the same label under a different seed as a different run', () => {
    const plan = planMigration(
      inventory({ runs: [run('r1', 'sweep', 1), run('r2', 'sweep', 2)] }),
      new Set(),
      new Set()
    )
    assert.equal(plan.runs.length, 2)
  })

  it('is idempotent — a second plan over the same state sends nothing', () => {
    const local = inventory({ functions: [fn('f1')], configs: [cfg('c1')], runs: [run('r1', 'a')] })
    const first = planMigration(local, new Set(), new Set())
    const uploaded = new Set([
      ...first.functions.map((f) => f.id),
      ...first.configs.map((c) => c.id),
      ...first.runs.map((r) => r.id),
    ])
    const second = planMigration(local, uploaded, new Set(first.runs.map(runKey)))
    assert.equal(second.functions.length + second.configs.length + second.runs.length, 0)
  })

  it('handles an empty browser', () => {
    const plan = planMigration(inventory(), new Set(), new Set())
    assert.deepEqual(
      [plan.functions.length, plan.configs.length, plan.runs.length, plan.duplicateRuns.length],
      [0, 0, 0, 0]
    )
  })
})

describe('runKey', () => {
  it('combines label and seed', () => {
    assert.equal(runKey({ label: 'a run', config: { seed: 42 } }), 'a run|42')
  })
})
