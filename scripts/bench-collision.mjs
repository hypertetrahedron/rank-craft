/**
 * The scenario in question: the two best players in the field meet in round 1.
 * The loser is capped at 5-1 and, at a large event, will usually be beaten to
 * second place by someone who never had to play anybody good.
 *
 * This isolates that effect. Round 1 is FORCED to pair true #1 against true #2
 * (the only place ground truth is used — to construct the scenario, never to
 * score it); every later round uses the strategy under test. We then ask where
 * the loser of that game actually finished.
 *
 *   node scripts/bench-collision.mjs [--players 64] [--rounds 6] [--reps 300]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { loadPyodide } from 'pyodide'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PY = path.join(ROOT, 'public', 'py')

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 ? process.argv[i + 1] : d
}
const PLAYERS = Number(arg('players', 64))
const ROUNDS = Number(arg('rounds', 6))
const REPS = Number(arg('reps', 300))
const SEED = Number(arg('seed', 20260808))

const py = await loadPyodide()
for (const w of readdirSync(path.join(PY, 'wheels'))) {
  await py.loadPackage(path.join(PY, 'wheels', w).replace(/\\/g, '/'))
}
for (const f of ['metrics.py', 'harness.py']) {
  py.FS.writeFile(`/home/pyodide/${f}`, readFileSync(path.join(PY, f), 'utf8'))
}
await py.runPythonAsync(`import sys; sys.path.insert(0,'/home/pyodide'); import harness`)

function split(src) {
  const re = /^##--\s*([a-z0-9_]+)\s*\|\s*([\s\S]*?)\s*--##\s*$/gm
  const m = []
  let x
  while ((x = re.exec(src))) m.push({ name: x[1], s: x.index, b: x.index + x[0].length })
  return m.map((k, i) => ({
    name: k.name,
    code: src.slice(k.b, i + 1 < m.length ? m[i + 1].s : src.length).trim(),
  }))
}
const B = {}
for (const f of readdirSync(path.join(PY, 'builtins'))) {
  B[path.basename(f, '.py')] = split(readFileSync(path.join(PY, 'builtins', f), 'utf8'))
}
const pick = (k, n) => B[k].find((x) => x.name === n).code

/**
 * Wraps a pairing function so round 1 forces the true top two together.
 * Reading p.skill is cheating — which is the point: we are constructing a
 * specific draw, not scoring one. Rounds 2+ are the real strategy, untouched.
 */
const forceCollision = (inner) => `
${inner}

_inner_pair = pair_round


def pair_round(t, ctx):
    if ctx.round != 1:
        return _inner_pair(t, ctx)
    ranked = sorted(t.players.values(), key=lambda p: -p.skill)
    best, second = ranked[0].id, ranked[1].id
    rest = [p.id for p in t.players.values() if p.id not in (best, second)]
    ctx.rng.shuffle(rest)
    pairs = [(best, second)]
    if len(rest) % 2 == 1:
        pairs.append((rest.pop(), None))
    for i in range(0, len(rest), 2):
        pairs.append((rest[i], rest[i + 1]))
    return pairs
`

const base = (over = {}) => ({
  players: PLAYERS,
  rounds: ROUNDS,
  replications: REPS,
  seed: SEED,
  bye_points: 1,
  skill: { kind: 'normal', mean: 1600, stdev: 200 },
  variance: { kind: 'normal', max_up: 210, max_down: 210, skill_coupling: 0, exponent: 1 },
  initial_rating: { mode: 'flat', value: 1500 },
  functions: {
    seeding: { code: pick('seeding', 'random') },
    pairing: { code: pick('pairing', 'w40k_swiss') },
    outcome: { code: pick('outcome', 'w40k_battle_points') },
    rating: { code: pick('rating', 'none') },
    ranking: { code: pick('ranking', 'w40k_standings') },
  },
  ...over,
})

const run = (cfg) => {
  py.globals.set('_c', JSON.stringify(cfg))
  const r = JSON.parse(py.runPython('harness.run_batch(_c)'))
  if (!r.ok) throw new Error(r.error)
  return r
}
const mean = (xs) => {
  const v = xs.filter((x) => x !== null && Number.isFinite(x))
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN
}
const pctAtMost = (xs, k) => {
  const v = xs.filter((x) => x !== null && Number.isFinite(x))
  return v.filter((x) => x <= k).length / v.length
}
/**
 * Paired difference. The field for replication r depends only on the seed, so
 * the collided and normal runs face an identical set of players and the
 * per-replication difference removes field variance — without which a swing of
 * a fraction of a place is invisible under the noise of who showed up.
 */
const pairedDiff = (a, b) => {
  const d = []
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] === null || b[i] === null) continue
    d.push(a[i] - b[i])
  }
  if (d.length < 2) return { mean: NaN, ci: NaN }
  const m = d.reduce((x, y) => x + y, 0) / d.length
  const sd = Math.sqrt(d.reduce((x, y) => x + (y - m) ** 2, 0) / (d.length - 1))
  return { mean: m, ci: 1.96 * (sd / Math.sqrt(d.length)) }
}

const COMBOS = [
  ['w40k_swiss', 'w40k_standings', 'the real-world baseline'],
  ['w40k_swiss', 'w40k_standings_sos', 'baseline + strength of schedule'],
  ['w40k_swiss', 'record_then_ridge', 'record first, margin model as tiebreak'],
  ['w40k_swiss', 'ridge_margin', 'margin model, record ignored'],
  ['info_gain_bracketed', 'ridge_margin', 'information pairing + margin model'],
  ['info_gain_censored', 'ridge_margin', 'unbracketed info pairing + margin model'],
]

console.log(
  `Round-1 collision: true #1 vs true #2 forced in round 1.\n` +
    `${PLAYERS} players, ${ROUNDS} rounds, ${REPS} replications, seed ${SEED}.\n` +
    `Reported: where the true #2 finished, and how often they still made the top 2 / top 5.\n`
)
console.log(
  '  ' +
    'configuration'.padEnd(46) +
    '#2 finished'.padStart(12) +
    'top 2'.padStart(9) +
    'top 5'.padStart(9) +
    '     vs a normal draw'
)

for (const [pairing, ranking, label] of COMBOS) {
  const fns = {
    ...base().functions,
    pairing: { code: pick('pairing', pairing) },
    ranking: { code: pick('ranking', ranking) },
  }
  const collided = run(
    base({ functions: { ...fns, pairing: { code: forceCollision(pick('pairing', pairing)) } } })
  )
  const normal = run(base({ functions: fns }))

  const c = collided.final.true_second_place
  const nrm = normal.final.true_second_place
  const d = pairedDiff(c, nrm)
  const verdict = Math.abs(d.mean) > d.ci ? '' : '  (not detectable)'
  console.log(
    '  ' +
      `${pairing} | ${ranking}`.padEnd(46) +
      mean(c).toFixed(2).padStart(12) +
      `${(pctAtMost(c, 2) * 100).toFixed(0)}%`.padStart(9) +
      `${(pctAtMost(c, 5) * 100).toFixed(0)}%`.padStart(9) +
      `     ${mean(nrm).toFixed(2)}   cost ${(d.mean >= 0 ? '+' : '') + d.mean.toFixed(2)} ± ${d.ci.toFixed(2)}${verdict}`
  )
}

console.log(
  '\n"cost" is the paired difference in the true #2\'s finishing place caused purely by\n' +
    'being drawn against the best player in the room in round 1. ± is a 95% interval;\n' +
    'an interval straddling zero means the draw did not measurably cost them anything.'
)
