/**
 * How many rounds does each system need?
 *
 * The practical question behind all of this: a 6-round event is what people can
 * fit in a weekend. If a better estimator gets you the accuracy of an 8-round
 * event in 6 rounds, that is worth more than any tiebreak argument.
 *
 *   node scripts/bench-rounds.mjs [--players 64] [--reps 150]
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
const REPS = Number(arg('reps', 150))
const SEED = Number(arg('seed', 20260808))
const ROUND_RANGE = [3, 4, 5, 6, 7, 8, 9, 10]

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

const cfg = (rounds, pairing, ranking) => ({
  players: PLAYERS,
  rounds,
  replications: REPS,
  seed: SEED,
  bye_points: 1,
  skill: { kind: 'normal', mean: 1600, stdev: 200 },
  variance: { kind: 'normal', max_up: 210, max_down: 210, skill_coupling: 0, exponent: 1 },
  initial_rating: { mode: 'flat', value: 1500 },
  functions: {
    seeding: { code: pick('seeding', 'random') },
    pairing: { code: pick('pairing', pairing) },
    outcome: { code: pick('outcome', 'w40k_battle_points') },
    rating: { code: pick('rating', 'none') },
    ranking: { code: pick('ranking', ranking) },
  },
})

const run = (c) => {
  py.globals.set('_c', JSON.stringify(c))
  const r = JSON.parse(py.runPython('harness.run_batch(_c)'))
  if (!r.ok) throw new Error(r.error)
  return r
}
const mean = (xs) => {
  const v = xs.filter((x) => x !== null && Number.isFinite(x))
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN
}

const SYSTEMS = [
  ['w40k_swiss', 'w40k_standings', 'classic (record + battle points)'],
  ['w40k_swiss', 'record_then_ridge', 'record, margin model as tiebreak'],
  ['w40k_swiss', 'ridge_margin', 'margin model'],
  ['info_gain_bracketed', 'ridge_margin', 'info pairing + margin model'],
]

console.log(
  `Kendall τ by round count — ${PLAYERS} players, ${REPS} replications, seed ${SEED}\n`
)
console.log('  ' + 'system'.padEnd(38) + ROUND_RANGE.map((r) => `R${r}`.padStart(8)).join(''))

const table = {}
for (const [pairing, ranking, label] of SYSTEMS) {
  const row = []
  for (const rounds of ROUND_RANGE) {
    row.push(mean(run(cfg(rounds, pairing, ranking)).final.kendall_tau))
  }
  table[label] = row
  console.log('  ' + label.padEnd(38) + row.map((v) => v.toFixed(4).padStart(8)).join(''))
}

// How many rounds does the classic system need to match each alternative at 6?
const classic = table['classic (record + battle points)']
console.log('\nrounds the classic system needs to match each alternative at 6 rounds:\n')
for (const [label, row] of Object.entries(table)) {
  if (label.startsWith('classic')) continue
  const target = row[ROUND_RANGE.indexOf(6)]
  let need = null
  for (let i = 0; i < ROUND_RANGE.length; i++) {
    if (classic[i] >= target) {
      need = ROUND_RANGE[i]
      break
    }
  }
  console.log(
    `  ${label.padEnd(38)} τ ${target.toFixed(4)} at 6 rounds → classic needs ` +
      (need ? `${need} rounds` : `more than ${ROUND_RANGE[ROUND_RANGE.length - 1]} rounds`)
  )
}
