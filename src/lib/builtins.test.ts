import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { looksLikeCheating, parseParams, splitBuiltins } from './builtins.ts'
import { FUNCTION_KINDS } from './simConfig.ts'

const PY = path.join(process.cwd(), 'public', 'py', 'builtins')

describe('splitBuiltins', () => {
  const source = [
    '# a leading comment that belongs to nobody',
    '##-- alpha | First one. --##',
    'def f():',
    '    return 1',
    '',
    '##-- beta | Second one,',
    'wrapped across lines. --##',
    'PARAMS = {}',
    'def f():',
    '    return 2',
  ].join('\n')

  it('splits on markers and keeps the code between them', () => {
    const out = splitBuiltins('pairing', source)
    assert.equal(out.length, 2)
    assert.equal(out[0].name, 'alpha')
    assert.equal(out[0].code, 'def f():\n    return 1')
    assert.equal(out[1].name, 'beta')
    assert.ok(out[1].code.startsWith('PARAMS'))
  })

  it('drops the preamble before the first marker', () => {
    assert.ok(!splitBuiltins('pairing', source)[0].code.includes('leading comment'))
  })

  it('collapses a description wrapped across lines', () => {
    assert.equal(splitBuiltins('pairing', source)[1].description, 'Second one, wrapped across lines.')
  })

  it('namespaces ids by kind', () => {
    assert.equal(splitBuiltins('ranking', source)[0].id, 'builtin:ranking:alpha')
    assert.equal(splitBuiltins('pairing', source)[0].id, 'builtin:pairing:alpha')
  })

  it('returns nothing for a file with no markers', () => {
    assert.deepEqual(splitBuiltins('pairing', 'def f(): pass'), [])
  })

  it('is not stateful across calls', () => {
    // the module-level regex carries lastIndex; a second call must not skip
    assert.equal(splitBuiltins('pairing', source).length, splitBuiltins('pairing', source).length)
  })
})

describe('parseParams', () => {
  it('reads a numeric parameter block', () => {
    const p = parseParams("PARAMS = {\n  'k': {'default': 32.0, 'min': 1.0, 'max': 128.0, 'step': 1.0},\n}")
    assert.deepEqual(p.k, { default: 32, min: 1, max: 128, step: 1 })
  })

  it('reads several parameters and negative defaults', () => {
    const p = parseParams(
      "PARAMS = {\n  'a': {'default': -5, 'min': -10, 'max': 0},\n  'b': {'default': 2},\n}"
    )
    assert.equal(p.a.default, -5)
    assert.equal(p.b.default, 2)
    assert.equal(Object.keys(p).length, 2)
  })

  it('reads booleans and strings', () => {
    const p = parseParams("PARAMS = {\n  'on': {'default': True},\n  'mode': {'default': 'fold'},\n}")
    assert.equal(p.on.default, true)
    assert.equal(p.mode.default, 'fold')
  })

  it('ignores entries with no default', () => {
    assert.deepEqual(parseParams("PARAMS = {\n  'x': {'min': 1},\n}"), {})
  })

  it('returns nothing when there is no PARAMS block', () => {
    assert.deepEqual(parseParams('def pair_round(t, ctx):\n    return []'), {})
  })

  it('is not confused by a later dict in the body', () => {
    const p = parseParams(
      "PARAMS = {\n  'k': {'default': 3},\n}\n\n\ndef f(t, ctx):\n    d = {'other': {'default': 99}}\n    return d"
    )
    assert.equal(Object.keys(p).length, 1)
    assert.equal(p.k.default, 3)
  })

  it('does not match PARAMS mentioned inside a comment or string', () => {
    assert.deepEqual(parseParams("# PARAMS = {'x': {'default': 1}}\ndef f(): pass"), {})
  })
})

describe('looksLikeCheating', () => {
  it('flags true skill in pairing and ranking', () => {
    assert.equal(looksLikeCheating('ranking', 'sorted(t.players.values(), key=lambda p: -p.skill)'), true)
    assert.equal(looksLikeCheating('pairing', 'x = p.skill'), true)
  })

  it('does not flag the hooks that legitimately see skill', () => {
    // play_match is handed effective skill by design; the rating hook cannot
    // reach a Player's true skill through a MatchRecord.
    assert.equal(looksLikeCheating('outcome', 'def play_match(skill_a, skill_b, ctx): pass'), false)
    assert.equal(looksLikeCheating('rating', 'r.skill_a'), false)
    assert.equal(looksLikeCheating('seeding', 'p.skill'), false)
  })

  it('does not flag unrelated attributes', () => {
    assert.equal(looksLikeCheating('ranking', 'p.skillet'), false)
    assert.equal(looksLikeCheating('ranking', 'p.rating'), false)
  })
})

describe('the shipped built-in library', () => {
  const files = readdirSync(PY).filter((f) => f.endsWith('.py'))

  it('has a file for every function kind', () => {
    for (const kind of FUNCTION_KINDS) assert.ok(files.includes(`${kind}.py`), `missing ${kind}.py`)
  })

  for (const file of readdirSync(PY).filter((f) => f.endsWith('.py'))) {
    const kind = path.basename(file, '.py') as (typeof FUNCTION_KINDS)[number]
    const entries = splitBuiltins(kind, readFileSync(path.join(PY, file), 'utf8'))

    it(`${file}: parses into named, described, non-empty snippets`, () => {
      assert.ok(entries.length > 0)
      for (const e of entries) {
        assert.ok(e.description.length > 10, `${e.name} has no real description`)
        assert.ok(e.code.length > 0, `${e.name} has no code`)
      }
    })

    it(`${file}: every snippet defines the hook its kind requires`, () => {
      const required = {
        seeding: 'def seed_order(',
        pairing: 'def pair_round(',
        outcome: 'def play_match(',
        rating: 'def update_ratings(',
        ranking: 'def rank_players(',
      }[kind]
      for (const e of entries) {
        assert.ok(e.code.includes(required), `${kind}/${e.name} is missing ${required}`)
      }
    })

    it(`${file}: names are unique`, () => {
      const names = entries.map((e) => e.name)
      assert.equal(new Set(names).size, names.length, `duplicate names in ${file}`)
    })

    it(`${file}: only 'oracle' reads true skill`, () => {
      for (const e of entries) {
        if (e.name === 'oracle') continue
        assert.equal(looksLikeCheating(kind, e.code), false, `${kind}/${e.name} reads .skill`)
      }
    })
  }
})
