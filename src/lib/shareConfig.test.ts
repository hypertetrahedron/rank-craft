import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decodeConfig, encodeConfig } from './shareConfig.ts'
import { defaultConfig } from './simConfig.ts'

describe('config links', () => {
  it('round-trips an unchanged config', () => {
    const cfg = defaultConfig()
    assert.deepEqual(decodeConfig(encodeConfig(cfg)), cfg)
  })

  it('round-trips every kind of change', () => {
    const cfg = defaultConfig()
    const edited = {
      ...cfg,
      players: 128,
      rounds: 9,
      seed: 777,
      bracket_by: 'wins' as const,
      top_cut: 8,
      skill: { ...cfg.skill, kind: 'normal' as const, mean: 1700 },
      matchup: { kind: 'circular' as const, archetypes: 4, amplitude: 250 },
      side: { mode: 'random' as const, advantage: 40 },
      fatigue: { amplitude: 30, spread: 0.5 },
      functions: {
        ...cfg.functions,
        ranking: { ...cfg.functions.ranking, name: 'mine', code: 'def rank_players(t, ctx):\n    return sorted(t.players)' },
      },
    }
    assert.deepEqual(decodeConfig(encodeConfig(edited)), edited)
  })

  it('carries only what differs, so a link stays short', () => {
    const cfg = defaultConfig()
    const bare = encodeConfig(cfg)
    const oneChange = encodeConfig({ ...cfg, seed: 999 })
    assert.ok(bare.length < 20, `an unchanged config encoded to ${bare.length} chars`)
    assert.ok(oneChange.length < 40, `a one-field change encoded to ${oneChange.length} chars`)
  })

  it('survives a very long function body without corrupting it', () => {
    const cfg = defaultConfig()
    const code = '# ' + 'x'.repeat(5000) + '\ndef rank_players(t, ctx):\n    return sorted(t.players)'
    const edited = { ...cfg, functions: { ...cfg.functions, ranking: { ...cfg.functions.ranking, code } } }
    assert.equal(decodeConfig(encodeConfig(edited))?.functions.ranking.code, code)
  })

  it('handles non-ASCII in a function body', () => {
    // base64 of raw charCodes would mangle these; the codec goes through UTF-8
    const cfg = defaultConfig()
    const code = '# τ ≥ 0.85 — ολοκλήρωση 🎲\ndef rank_players(t, ctx):\n    return sorted(t.players)'
    const edited = { ...cfg, functions: { ...cfg.functions, ranking: { ...cfg.functions.ranking, code } } }
    assert.equal(decodeConfig(encodeConfig(edited))?.functions.ranking.code, code)
  })

  it('returns null for a mangled link rather than throwing', () => {
    assert.equal(decodeConfig('not-base64!!'), null)
    assert.equal(decodeConfig(''), null)
    assert.equal(decodeConfig(btoa('{"players": "many"}')), null)
  })
})
