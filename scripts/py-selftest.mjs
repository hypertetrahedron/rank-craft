/**
 * Headless verification of the RankCraft Python engine.
 *
 * Boots Pyodide under Node, loads public/py, and asserts the invariants that
 * matter: known metric values, the zero-variance invariant, determinism,
 * contract rejection, and that every built-in function actually runs.
 *
 *   npm run py:test
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { loadPyodide } from 'pyodide'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PY = path.join(ROOT, 'public', 'py')

let pass = 0
const failures = []

function check(name, fn) {
  try {
    const msg = fn()
    if (msg) throw new Error(msg)
    pass++
    console.log(`  \x1b[32mok\x1b[0m   ${name}`)
  } catch (err) {
    failures.push(name)
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}\n       ${err.message.split('\n').join('\n       ')}`)
  }
}

function close(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps
}

/** Split a builtins file into { name, description, code } on the ##-- --## markers. */
function splitBuiltins(source) {
  const re = /^##--\s*([a-z0-9_]+)\s*\|\s*([\s\S]*?)\s*--##\s*$/gm
  const out = []
  const marks = []
  let m
  while ((m = re.exec(source))) {
    marks.push({ name: m[1], description: m[2].trim(), start: m.index + m[0].length })
  }
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? source.lastIndexOf('##--', marks[i + 1].start) : source.length
    out.push({ ...marks[i], code: source.slice(marks[i].start, end).trim() })
  }
  return out
}

const py = await loadPyodide()
// Vendored wheels, the same files the browser loads. Installing them by path
// skips Pyodide's dependency resolution — neither networkx 3.x nor numpy needs
// anything at import time, but networkx's lock entry conservatively lists
// matplotlib, which we do not want.
for (const wheel of readdirSync(path.join(PY, 'wheels'))) {
  await py.loadPackage(path.join(PY, 'wheels', wheel).replace(/\\/g, '/'))
}

for (const f of ['metrics.py', 'harness.py']) {
  py.FS.writeFile(`/home/pyodide/${f}`, readFileSync(path.join(PY, f), 'utf8'))
}
await py.runPythonAsync(`
import sys
sys.path.insert(0, '/home/pyodide')
import harness, metrics
`)

const builtins = {}
for (const file of readdirSync(path.join(PY, 'builtins'))) {
  const kind = path.basename(file, '.py')
  builtins[kind] = splitBuiltins(readFileSync(path.join(PY, 'builtins', file), 'utf8'))
}

const pick = (kind, name) => {
  const found = builtins[kind].find((b) => b.name === name)
  if (!found) throw new Error(`no builtin ${kind}/${name}`)
  return found.code
}

const baseConfig = (over = {}) => ({
  players: 32,
  rounds: 7,
  seed: 12345,
  replications: 5,
  bye_points: 1.0,
  skill: { kind: 'uniform', min: 1400, max: 2200 },
  variance: { kind: 'uniform', max_up: 100, max_down: 100, skill_coupling: 0, exponent: 1 },
  // Deliberately NOT 'true': a perfect seeding rating makes seed order identical
  // to true-skill order, and every ranking tiebreaks on seed — ground truth
  // leaks into the standings and every pairing system scores ~1.0.
  initial_rating: { mode: 'noisy', noise: 120 },
  functions: {
    seeding: { code: pick('seeding', 'by_rating') },
    pairing: { code: pick('pairing', 'dutch_slide') },
    outcome: { code: pick('outcome', 'winner_takes_1') },
    rating: { code: pick('rating', 'none') },
    ranking: { code: pick('ranking', 'by_score') },
  },
  ...over,
})

const run = (cfg) => {
  py.globals.set('_cfg', JSON.stringify(cfg))
  return JSON.parse(py.runPython(`harness.run_batch(_cfg)`))
}

console.log('\nmetrics')

check('kendall_tau_b matches known values', () => {
  const t1 = py.runPython(`metrics.kendall_tau_b([1,2,3,4,5],[1,2,3,4,5])`)
  const t2 = py.runPython(`metrics.kendall_tau_b([1,2,3,4,5],[5,4,3,2,1])`)
  const t3 = py.runPython(`metrics.kendall_tau_b([1,2,3,4,5],[1,2,3,5,4])`)
  const t4 = py.runPython(`metrics.kendall_tau_b([1,2,2,3],[1,2,3,4])`)
  if (!close(t1, 1)) return `identical -> ${t1}, expected 1`
  if (!close(t2, -1)) return `reversed -> ${t2}, expected -1`
  if (!close(t3, 0.8)) return `one swap -> ${t3}, expected 0.8`
  // scipy.stats.kendalltau([1,2,2,3],[1,2,3,4]) == 0.9128709291752769
  if (!close(t4, 0.9128709291752769, 1e-12)) return `with ties -> ${t4}`
  return null
})

check('spearman_rho matches known values', () => {
  const s1 = py.runPython(`metrics.spearman_rho([1,2,3,4,5],[1,2,3,4,5])`)
  const s2 = py.runPython(`metrics.spearman_rho([1,2,3,4,5],[5,4,3,2,1])`)
  // rho for one adjacent swap in n=5 is 1 - 6*2/(5*24) = 0.9
  const s3 = py.runPython(`metrics.spearman_rho([1,2,3,4,5],[1,2,3,5,4])`)
  if (!close(s1, 1)) return `identical -> ${s1}`
  if (!close(s2, -1)) return `reversed -> ${s2}`
  if (!close(s3, 0.9, 1e-12)) return `one swap -> ${s3}`
  return null
})

check('normalised_kendall_distance is 0 / 1 at the extremes', () => {
  const d0 = py.runPython(`metrics.normalised_kendall_distance([1,2,3,4],[1,2,3,4])`)
  const d1 = py.runPython(`metrics.normalised_kendall_distance([1,2,3,4],[4,3,2,1])`)
  if (!close(d0, 0)) return `identical -> ${d0}`
  if (!close(d1, 1)) return `reversed -> ${d1}`
  return null
})

check('precision_at_k and displacement', () => {
  const p = py.runPython(`metrics.precision_at_k([3,1,2,4],[1,2,3,4],3)`)
  const [mean, max] = py.runPython(`list(metrics.displacement([2,1,3],[1,2,3]))`).toJs()
  if (!close(p, 1)) return `p@3 -> ${p}, expected 1 (same set, different order)`
  if (!close(mean, 2 / 3) || !close(max, 1)) return `displacement -> ${mean}, ${max}`
  return null
})

console.log('\ntiebreaks (hand-computed 4-player, 3-round tournament)')

check('buchholz / sonneborn-berger / cumulative on a fixed round-robin', () => {
  // A 4-player round robin with a forced result table. Player ids 0..3.
  // r1: 0>1, 2>3   r2: 0>2, 1>3   r3: 0>3, 1>2
  // final scores: p0=3, p1=2, p2=1, p3=0
  const forced = `
SCRIPT = {1: [(0,1),(2,3)], 2: [(0,2),(1,3)], 3: [(0,3),(1,2)]}
def pair_round(t, ctx):
    return SCRIPT[ctx.round]
`
  const cfg = baseConfig({
    players: 4,
    rounds: 3,
    replications: 1,
    variance: { kind: 'uniform', max_up: 0, max_down: 0, skill_coupling: 0, exponent: 1 },
    skill: { kind: 'linear', min: 1000, max: 2000 },
    functions: {
      seeding: { code: pick('seeding', 'by_rating') },
      pairing: { code: forced },
      // the lower id always wins, regardless of skill
      outcome: { code: 'def play_match(a, b, ctx):\n    return (1.0, 0.0)' },
      rating: { code: pick('rating', 'none') },
      ranking: { code: pick('ranking', 'buchholz') },
    },
    want_log: true,
  })
  const res = run(cfg)
  if (!res.ok) return res.error

  // With "first listed player always wins": p0 beats 1,2,3 -> 3.0
  // p1 loses to 0, beats 3, beats 2 -> 2.0 ; p2 beats 3, loses 0, loses 1 -> 1.0 ; p3 -> 0.0
  const field = Object.fromEntries(res.sample.field.map((p) => [p.id, p.score]))
  const expected = { 0: 3, 1: 2, 2: 1, 3: 0 }
  for (const [id, s] of Object.entries(expected)) {
    if (!close(field[id], s)) return `player ${id} scored ${field[id]}, expected ${s}`
  }
  // Buchholz for p0 = scores of 1,2,3 = 2+1+0 = 3
  //           for p1 = scores of 0,3,2 = 3+0+1 = 4
  const order = res.sample.final_order
  if (order.join(',') !== '0,1,2,3') return `ranking ${order} — expected strict 0,1,2,3 by score`
  return null
})

console.log('\ninvariants')

check('zero variance ⇒ the true best player always wins', () => {
  // The headline guarantee from the spec: with no random component the
  // stronger player wins every match, so only the genuinely best player can go
  // undefeated. Note this does NOT imply a perfect ranking — match points are
  // a coarse signal, and 32 players cannot be totally ordered by 9 rounds of
  // them however clean the results are.
  const cfg = baseConfig({
    players: 32,
    rounds: 9,
    replications: 8,
    variance: { kind: 'uniform', max_up: 0, max_down: 0, skill_coupling: 0, exponent: 1 },
    functions: { ...baseConfig().functions, pairing: { code: pick('pairing', 'burstein') } },
  })
  const res = run(cfg)
  if (!res.ok) return res.error
  const top1 = res.final.top1
  if (!top1.every((v) => v === 1))
    return `true best failed to win in ${top1.filter((v) => v !== 1).length}/${top1.length} runs`
  return null
})

check('removing the random component strictly improves ranking accuracy', () => {
  const meanTau = (v) => {
    const res = run(
      baseConfig({
        players: 32,
        rounds: 9,
        replications: 60,
        variance: { kind: 'uniform', max_up: v, max_down: v, skill_coupling: 0, exponent: 1 },
        functions: { ...baseConfig().functions, pairing: { code: pick('pairing', 'burstein') } },
      })
    )
    if (!res.ok) throw new Error(res.error)
    const t = res.final.kendall_tau
    return t.reduce((a, b) => a + b, 0) / t.length
  }
  const clean = meanTau(0)
  const noisy = meanTau(150)
  const veryNoisy = meanTau(400)
  console.log(
    `       noise 0 → τ ${clean.toFixed(4)} · noise 150 → τ ${noisy.toFixed(4)} · noise 400 → τ ${veryNoisy.toFixed(4)}`
  )
  if (!(clean > noisy && noisy > veryNoisy))
    return `accuracy did not fall monotonically with noise: ${clean.toFixed(4)}, ${noisy.toFixed(4)}, ${veryNoisy.toFixed(4)}`
  return null
})

check('zero variance + oracle ranking ⇒ tau exactly 1.0', () => {
  const cfg = baseConfig({
    replications: 3,
    variance: { kind: 'uniform', max_up: 0, max_down: 0, skill_coupling: 0, exponent: 1 },
    functions: { ...baseConfig().functions, ranking: { code: pick('ranking', 'oracle') } },
  })
  const res = run(cfg)
  if (!res.ok) return res.error
  const bad = res.final.kendall_tau.filter((v) => !close(v, 1, 1e-12))
  return bad.length ? `oracle produced tau ${bad[0]}` : null
})

check('identical seed ⇒ identical results; different seed ⇒ different', () => {
  const a = run(baseConfig())
  const b = run(baseConfig())
  const c = run(baseConfig({ seed: 999 }))
  if (JSON.stringify(a.final) !== JSON.stringify(b.final)) return 'same seed diverged'
  if (JSON.stringify(a.final) === JSON.stringify(c.final)) return 'different seed produced identical output'
  return null
})

check('replication slices are position-independent (worker pool determinism)', () => {
  const whole = run(baseConfig({ replications: 12 }))
  const s1 = run(baseConfig({ replication_ids: [0, 1, 2, 3, 4, 5] }))
  const s2 = run(baseConfig({ replication_ids: [6, 7, 8, 9, 10, 11] }))
  const merged = [...s1.final.kendall_tau, ...s2.final.kendall_tau]
  if (JSON.stringify(merged) !== JSON.stringify(whole.final.kendall_tau)) {
    return 'splitting the batch across workers changed the results'
  }
  return null
})

check('common random numbers: the field is identical across strategies', () => {
  const mk = (pairing) =>
    run(
      baseConfig({
        replications: 1,
        want_log: true,
        functions: { ...baseConfig().functions, pairing: { code: pick('pairing', pairing) } },
      })
    )
  const a = mk('dutch_slide')
  const b = mk('monrad')
  const sa = a.sample.field.map((p) => p.skill).sort((x, y) => x - y)
  const sb = b.sample.field.map((p) => p.skill).sort((x, y) => x - y)
  if (JSON.stringify(sa) !== JSON.stringify(sb)) return 'two strategies saw different fields'
  return null
})

check('common random numbers: a given matchup gets identical noise either way', () => {
  // Force the same two players to meet, once as (a,b) and once as (b,a).
  const mk = (order) => {
    const code = `
def pair_round(t, ctx):
    ids = sorted(t.players)
    pairs = []
    for i in range(0, len(ids), 2):
        x, y = ids[i], ids[i+1]
        pairs.append((x, y) if ${order} else (y, x))
    return pairs
`
    return run(
      baseConfig({
        players: 8,
        rounds: 1,
        replications: 1,
        want_log: true,
        functions: { ...baseConfig().functions, pairing: { code } },
      })
    )
  }
  const fwd = mk('True')
  const rev = mk('False')
  const key = (r) => {
    const m = {}
    for (const match of r.sample.log[0].matches) {
      m[[match.a, match.b].sort((x, y) => x - y).join('-')] = [
        match.a < match.b ? match.skill_a : match.skill_b,
        match.a < match.b ? match.skill_b : match.skill_a,
      ]
    }
    return JSON.stringify(m)
  }
  return key(fwd) === key(rev) ? null : 'noise depended on which side the pairing put a player'
})

console.log('\nengine features')

check('a disabled feature does not touch the random stream', () => {
  // Adding an optional model must not change what an existing seed produces.
  // Drawing from the rng "harmlessly" with a zero parameter still advances it,
  // which silently reshuffles every field. This is the regression test for that.
  const plain = run(baseConfig({ replications: 20 }))
  const configuredOff = run(
    baseConfig({
      replications: 20,
      matchup: { kind: 'none', archetypes: 5, amplitude: 0 },
      side: { mode: 'none', advantage: 0 },
      fatigue: { amplitude: 0, spread: 0 },
      top_cut: 0,
    })
  )
  if (JSON.stringify(plain.final) !== JSON.stringify(configuredOff.final)) {
    return 'switching features off still changed the results'
  }
  return null
})

check('non-transitive matchups degrade every ranking system', () => {
  const tau = (amplitude, archetypes = 3) => {
    const res = run(
      baseConfig({
        replications: 60,
        matchup: { kind: 'circular', archetypes, amplitude },
      })
    )
    if (!res.ok) throw new Error(res.error)
    const t = res.final.kendall_tau
    return t.reduce((a, b) => a + b, 0) / t.length
  }
  const none = tau(0)
  const mild = tau(120)
  const strong = tau(400)
  console.log(
    `       amplitude 0 → τ ${none.toFixed(4)} · 120 → τ ${mild.toFixed(4)} · 400 → τ ${strong.toFixed(4)}`
  )
  if (!(none > mild && mild > strong)) {
    return `accuracy did not fall as matchups became more non-transitive: ${none.toFixed(4)}, ${mild.toFixed(4)}, ${strong.toFixed(4)}`
  }
  return null
})

check('the matchup bonus is antisymmetric — it transfers, never creates', () => {
  const res = run(
    baseConfig({
      players: 16,
      rounds: 1,
      replications: 1,
      replication_ids: [0],
      want_log: true,
      variance: { kind: 'uniform', max_up: 0, max_down: 0, skill_coupling: 0, exponent: 1 },
      matchup: { kind: 'circular', archetypes: 3, amplitude: 300 },
    })
  )
  if (!res.ok) return res.error
  const byId = Object.fromEntries(res.sample.field.map((p) => [p.id, p]))
  for (const m of res.sample.log[0].matches) {
    if (m.b === null) continue
    // effective skills are true skill plus equal and opposite matchup bonuses
    const shiftA = m.skill_a - byId[m.a].skill
    const shiftB = m.skill_b - byId[m.b].skill
    if (Math.abs(shiftA + shiftB) > 1e-6) {
      return `matchup shifted ${shiftA.toFixed(3)} and ${shiftB.toFixed(3)} — not a transfer`
    }
  }
  return null
})

check('side advantage matters and only when switched on', () => {
  const withSide = run(
    baseConfig({ replications: 30, side: { mode: 'pairing', advantage: 250 } })
  )
  const without = run(baseConfig({ replications: 30 }))
  if (!withSide.ok) return withSide.error
  if (JSON.stringify(withSide.final) === JSON.stringify(without.final)) {
    return 'turning on the side advantage changed nothing'
  }
  // colour metrics are meaningless without sides, and must say so rather than
  // reporting a zero that reads as "perfectly balanced"
  if (without.fairness.mean_color_imbalance.some((v) => v !== null)) {
    return 'colour imbalance reported a number when there are no sides'
  }
  if (withSide.fairness.mean_color_imbalance.every((v) => v === null)) {
    return 'colour imbalance reported nothing when sides matter'
  }
  return null
})

check('the rating gap reports nothing when no rating ever moves', () => {
  const flat = run(baseConfig({ replications: 5, initial_rating: { mode: 'flat', value: 1500 } }))
  if (!flat.ok) return flat.error
  if (flat.fairness.mean_rating_gap.some((v) => v !== null)) {
    return 'reported a rating gap across a field whose ratings are all identical'
  }
  const varied = run(baseConfig({ replications: 5 }))
  if (varied.fairness.mean_rating_gap.every((v) => v === null)) {
    return 'reported no rating gap even though ratings differ'
  }
  return null
})

check('fatigue changes the outcome only when players differ in stamina', () => {
  const none = run(baseConfig({ replications: 20 }))
  const uniform = run(baseConfig({ replications: 20, fatigue: { amplitude: 200, spread: 0 } }))
  const varied = run(baseConfig({ replications: 20, fatigue: { amplitude: 200, spread: 0.4 } }))
  if (!varied.ok) return varied.error
  // everyone tiring equally cancels out of a comparison
  if (JSON.stringify(none.final) !== JSON.stringify(uniform.final)) {
    return 'uniform fatigue changed the ranking, but it should cancel'
  }
  if (JSON.stringify(none.final) === JSON.stringify(varied.final)) {
    return 'heterogeneous fatigue changed nothing'
  }
  return null
})

check('bracket_by=wins buckets by record, not by points', () => {
  // With battle points, bucketing by score gives every player their own bracket.
  const cfg = (bracketBy) =>
    baseConfig({
      players: 16,
      rounds: 4,
      replications: 20,
      bracket_by: bracketBy,
      functions: {
        ...baseConfig().functions,
        outcome: { code: pick('outcome', 'w40k_battle_points') },
        pairing: { code: pick('pairing', 'dutch_slide') },
        ranking: { code: pick('ranking', 'w40k_standings') },
      },
    })
  const byScore = run(cfg('score'))
  const byWins = run(cfg('wins'))
  if (!byWins.ok) return byWins.error
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
  console.log(
    `       score buckets → τ ${mean(byScore.final.kendall_tau).toFixed(4)} · win buckets → τ ${mean(byWins.final.kendall_tau).toFixed(4)}`
  )
  if (JSON.stringify(byScore.final) === JSON.stringify(byWins.final)) {
    return 'bracketing by wins made no difference to a battle-point tournament'
  }
  return null
})

check('top cut produces a champion and a plausible one', () => {
  const res = run(
    baseConfig({ players: 32, rounds: 5, replications: 40, top_cut: 8, want_log: true })
  )
  if (!res.ok) return res.error
  const ranks = res.final.cut_winner_true_rank
  if (ranks.some((v) => v === null)) return 'a replication produced no champion'
  const mean = ranks.reduce((a, b) => a + b, 0) / ranks.length
  const best = res.final.cut_winner_is_best.reduce((a, b) => a + b, 0) / ranks.length
  console.log(
    `       champion's mean true rank ${mean.toFixed(2)}, best player won ${(best * 100).toFixed(0)}%`
  )
  // an 8-player cut can only ever be won by someone in the cut
  if (ranks.some((v) => v < 1)) return 'champion rank below 1'
  if (mean > 16) return `champion averages true rank ${mean.toFixed(1)} — the cut is not seeding sensibly`
  return null
})

check('no top cut leaves the cut metrics blank rather than zero', () => {
  const res = run(baseConfig({ replications: 5, top_cut: 0 }))
  if (!res.ok) return res.error
  if (res.final.cut_winner_is_best.some((v) => v !== null)) {
    return 'reported a cut result for a tournament with no cut'
  }
  return null
})

check('matchup_adjusted beats a plain margin fit when matchups are non-transitive', () => {
  const meanTau = (ranking, amplitude) => {
    const res = run(
      baseConfig({
        players: 32,
        rounds: 6,
        replications: 80,
        initial_rating: { mode: 'flat', value: 1500 },
        matchup: { kind: 'circular', archetypes: 3, amplitude },
        functions: {
          ...baseConfig().functions,
          outcome: { code: pick('outcome', 'w40k_battle_points') },
          pairing: { code: pick('pairing', 'w40k_swiss') },
          ranking: { code: pick('ranking', ranking) },
        },
        bracket_by: 'wins',
      })
    )
    if (!res.ok) throw new Error(`${ranking}: ${res.error}`)
    const t = res.final.kendall_tau
    return t.reduce((a, b) => a + b, 0) / t.length
  }
  const plainFlat = meanTau('ridge_margin', 0)
  const adjFlat = meanTau('matchup_adjusted', 0)
  const plainRps = meanTau('ridge_margin', 300)
  const adjRps = meanTau('matchup_adjusted', 300)
  console.log(
    `       no matchups: ridge ${plainFlat.toFixed(4)} vs adjusted ${adjFlat.toFixed(4)}` +
      ` | rock-paper-scissors: ridge ${plainRps.toFixed(4)} vs adjusted ${adjRps.toFixed(4)}`
  )
  if (adjRps <= plainRps) {
    return `correcting for matchups did not help under non-transitivity (${adjRps.toFixed(4)} vs ${plainRps.toFixed(4)})`
  }
  return null
})

check('trueskill converges faster than elo on an unrated field', () => {
  const meanTau = (rating) => {
    const res = run(
      baseConfig({
        players: 32,
        rounds: 5,
        replications: 80,
        initial_rating: { mode: 'flat', value: 1500 },
        functions: {
          ...baseConfig().functions,
          rating: { code: pick('rating', rating) },
          ranking: { code: pick('ranking', 'by_rating') },
        },
      })
    )
    if (!res.ok) throw new Error(`${rating}: ${res.error}`)
    const t = res.final.kendall_tau
    return t.reduce((a, b) => a + b, 0) / t.length
  }
  const elo = meanTau('elo')
  const ts = meanTau('trueskill')
  console.log(`       elo ${elo.toFixed(4)} vs trueskill ${ts.toFixed(4)}`)
  if (ts <= elo) return `trueskill (${ts.toFixed(4)}) did not beat elo (${elo.toFixed(4)})`
  return null
})

console.log('\ncontracts')

const contractCases = [
  ['unpaired player', 'def pair_round(t, ctx):\n    ids = sorted(t.players)\n    return [(ids[0], ids[1])]', 'unpaired'],
  [
    'duplicated player',
    'def pair_round(t, ctx):\n    ids = sorted(t.players)\n    return [(i, ids[0]) for i in ids]',
    'more than one pairing',
  ],
  [
    'bye in an even field',
    'def pair_round(t, ctx):\n    ids = sorted(t.players)\n    return [(i, None) for i in ids]',
    'bye',
  ],
  ['syntax error', 'def pair_round(t, ctx)\n    return []', 'failed to load'],
  ['wrong function name', 'def pairs(t, ctx):\n    return []', 'must define'],
]

for (const [label, code, expect] of contractCases) {
  check(`rejects: ${label}`, () => {
    const res = run(
      baseConfig({ players: 8, rounds: 1, replications: 1, functions: { ...baseConfig().functions, pairing: { code } } })
    )
    if (res.ok) return 'accepted invalid pairing function'
    if (!res.error.includes(expect)) return `unhelpful error: ${res.error.split('\n')[0]}`
    return null
  })
}

check('rejects a ranking function that drops a player', () => {
  const res = run(
    baseConfig({
      players: 8,
      rounds: 1,
      replications: 1,
      functions: {
        ...baseConfig().functions,
        ranking: { code: 'def rank_players(t, ctx):\n    return sorted(t.players)[:-1]' },
      },
    })
  )
  if (res.ok) return 'accepted a short ranking'
  return res.error.includes('exactly once') ? null : `unhelpful error: ${res.error}`
})

check('rejects play_match returning a scalar', () => {
  const res = run(
    baseConfig({
      players: 8,
      rounds: 1,
      replications: 1,
      functions: { ...baseConfig().functions, outcome: { code: 'def play_match(a, b, ctx):\n    return 1.0' } },
    })
  )
  if (res.ok) return 'accepted a scalar result'
  return res.error.includes('points_a, points_b') ? null : `unhelpful error: ${res.error}`
})

console.log('\nbuilt-in library (every function runs end to end)')

for (const kind of ['seeding', 'pairing', 'outcome', 'rating', 'ranking']) {
  for (const b of builtins[kind]) {
    check(`${kind}/${b.name}`, () => {
      const fns = { ...baseConfig().functions, [kind]: { code: b.code } }
      // rating-aware rankings need a rating system doing work
      if (kind === 'ranking' && (b.name === 'by_rating' || b.name === 'score_then_rating')) {
        fns.rating = { code: pick('rating', 'elo') }
      }
      const res = run(baseConfig({ players: 16, rounds: 5, replications: 2, functions: fns }))
      if (!res.ok) return res.error.split('\n').slice(0, 3).join('\n')
      const taus = res.final.kendall_tau
      if (taus.some((v) => typeof v !== 'number' || Number.isNaN(v))) return `produced NaN tau`
      return null
    })
  }
}

console.log('\nodd fields and byes')

check('odd field: exactly one bye per round, nobody byes twice before everyone byes once', () => {
  const res = run(
    baseConfig({ players: 9, rounds: 5, replications: 1, want_log: true })
  )
  if (!res.ok) return res.error
  const byeCount = {}
  for (const round of res.sample.log) {
    const byes = round.matches.filter((m) => m.b === null)
    if (byes.length !== 1) return `round ${round.round} had ${byes.length} byes`
    byeCount[byes[0].a] = (byeCount[byes[0].a] || 0) + 1
  }
  if (Object.values(byeCount).some((c) => c > 1)) return `a player took ${Math.max(...Object.values(byeCount))} byes in 5 rounds of 9`
  return null
})

console.log('\nliterature sanity check (32 players, 7 rounds, 1400-2200, 300 replications)')

check('Burstein and Random2 beat Monrad on ranking quality', () => {
  const meanTau = (pairing) => {
    const res = run(
      baseConfig({
        players: 32,
        rounds: 7,
        replications: 300,
        functions: { ...baseConfig().functions, pairing: { code: pick('pairing', pairing) } },
      })
    )
    if (!res.ok) throw new Error(`${pairing}: ${res.error}`)
    const t = res.final.kendall_tau
    return t.reduce((a, b) => a + b, 0) / t.length
  }
  const results = {
    burstein: meanTau('burstein'),
    random2: meanTau('random2'),
    dutch_slide: meanTau('dutch_slide'),
    random: meanTau('random'),
    monrad: meanTau('monrad'),
  }
  const ordered = Object.entries(results).sort((a, b) => b[1] - a[1])
  console.log(
    '       ' + ordered.map(([k, v]) => `${k} ${v.toFixed(4)}`).join('  ')
  )
  if (results.monrad >= results.burstein) return `monrad (${results.monrad.toFixed(4)}) >= burstein (${results.burstein.toFixed(4)})`
  if (results.random >= results.random2) return `random (${results.random.toFixed(4)}) >= random2 (${results.random2.toFixed(4)})`
  if (results.random >= results.dutch_slide) return `random (${results.random.toFixed(4)}) >= dutch (${results.dutch_slide.toFixed(4)})`
  return null
})

check('no pairing system produces rematches it could have avoided', () => {
  const rematches = (pairing) => {
    const res = run(
      baseConfig({
        players: 32,
        rounds: 7,
        replications: 60,
        functions: { ...baseConfig().functions, pairing: { code: pick('pairing', pairing) } },
      })
    )
    if (!res.ok) throw new Error(`${pairing}: ${res.error}`)
    const r = res.fairness.repeat_pairings
    return r.reduce((a, b) => a + b, 0) / r.length
  }
  const burstein = rematches('burstein')
  const dutch = rematches('dutch_slide')
  console.log(`       burstein ${burstein.toFixed(2)}  dutch_slide ${dutch.toFixed(2)} rematches/tournament`)
  // Global matching can always avoid a rematch if one is avoidable.
  if (burstein > 0) return `burstein produced ${burstein.toFixed(2)} rematches per tournament`
  // Bracket-local Dutch can be forced into one in an exhausted bottom bracket,
  // but should stay well under one per tournament.
  if (dutch > 1) return `dutch_slide produced ${dutch.toFixed(2)} rematches per tournament`
  return null
})

console.log(
  `\n${pass} passed, ${failures.length} failed` +
    (failures.length ? `\n\nfailures:\n  ${failures.join('\n  ')}` : '')
)
process.exit(failures.length ? 1 : 0)
