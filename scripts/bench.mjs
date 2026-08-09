/**
 * Systematic sweep over pairing × ranking strategies, under common random
 * numbers so every cell sees the identical field and identical match luck.
 *
 *   node scripts/bench.mjs [--players 64] [--rounds 6] [--reps 200] [--out file.json]
 *
 * Prints a table and writes the raw per-replication arrays, so paired tests and
 * charts can be built from the output rather than re-run.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { loadPyodide } from 'pyodide'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PY = path.join(ROOT, 'public', 'py')

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : dflt
}

const PLAYERS = Number(arg('players', 64))
const ROUNDS = Number(arg('rounds', 6))
const REPS = Number(arg('reps', 200))
const SEED = Number(arg('seed', 20260808))
const OUT = arg('out', null)

// ---------------------------------------------------------------- boot

const py = await loadPyodide()
for (const wheel of readdirSync(path.join(PY, 'wheels'))) {
  await py.loadPackage(path.join(PY, 'wheels', wheel).replace(/\\/g, '/'))
}
for (const f of ['metrics.py', 'harness.py']) {
  py.FS.writeFile(`/home/pyodide/${f}`, readFileSync(path.join(PY, f), 'utf8'))
}
await py.runPythonAsync(`
import sys
sys.path.insert(0, '/home/pyodide')
import harness
`)

function splitBuiltins(source) {
  const re = /^##--\s*([a-z0-9_]+)\s*\|\s*([\s\S]*?)\s*--##\s*$/gm
  const marks = []
  let m
  while ((m = re.exec(source))) marks.push({ name: m[1], start: m.index, body: m.index + m[0].length })
  return marks.map((mk, i) => ({
    name: mk.name,
    code: source.slice(mk.body, i + 1 < marks.length ? marks[i + 1].start : source.length).trim(),
  }))
}

const B = {}
for (const file of readdirSync(path.join(PY, 'builtins'))) {
  B[path.basename(file, '.py')] = splitBuiltins(readFileSync(path.join(PY, 'builtins', file), 'utf8'))
}
const pick = (kind, name) => {
  const f = B[kind].find((x) => x.name === name)
  if (!f) throw new Error(`no ${kind}/${name}`)
  return f.code
}

// ---------------------------------------------------------------- config

/**
 * An unrated field: nothing is known before round 1, which is the premise of
 * the question. Seeding is random, so a rating cannot leak through the seed
 * tiebreak. Skill is normal — most players cluster, a few are genuinely strong.
 */
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
  py.globals.set('_cfg', JSON.stringify(cfg))
  const res = JSON.parse(py.runPython('harness.run_batch(_cfg)'))
  if (!res.ok) throw new Error(`${res.error}\n${res.trace ?? ''}`)
  return res
}

const mean = (xs) => {
  const v = xs.filter((x) => x !== null && Number.isFinite(x))
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN
}
const ci95 = (xs) => {
  const v = xs.filter((x) => x !== null && Number.isFinite(x))
  if (v.length < 2) return 0
  const m = mean(v)
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1))
  return 1.96 * (sd / Math.sqrt(v.length))
}
/** Paired difference vs a baseline — the whole point of holding the seed fixed. */
const paired = (a, b) => {
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

// ---------------------------------------------------------------- sweep

const PAIRINGS = ['w40k_swiss', 'random', 'info_gain', 'info_gain_censored', 'info_gain_bracketed']
const RANKINGS = [
  'w40k_standings',
  'w40k_standings_sos',
  'ridge_wl',
  'ridge_margin',
  'ridge_margin_capped',
  'elo_mov',
  'record_then_ridge',
]

console.log(
  `RankCraft 40k sweep — ${PLAYERS} players, ${ROUNDS} rounds, ${REPS} replications, seed ${SEED}\n` +
    `unrated field (random seeding, flat starting ratings), battle points 0-100\n`
)

const results = {}
const started = Date.now()

for (const pairing of PAIRINGS) {
  for (const ranking of RANKINGS) {
    const key = `${pairing} | ${ranking}`
    const t0 = Date.now()
    const res = run(
      base({
        functions: {
          ...base().functions,
          pairing: { code: pick('pairing', pairing) },
          ranking: { code: pick('ranking', ranking) },
        },
      })
    )
    results[key] = { pairing, ranking, final: res.final, fairness: res.fairness, per_round: res.per_round }
    process.stdout.write(
      `  ${key.padEnd(44)} τ ${mean(res.final.kendall_tau).toFixed(4)}` +
        `  top2 ${(mean(res.final.p_at_2) * 100).toFixed(1)}%` +
        `  #2 finished ${mean(res.final.true_second_place).toFixed(2)}` +
        `  (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`
    )
  }
}

// oracle ceiling and a no-information floor, for scale
for (const [label, ranking] of [
  ['CEILING (oracle)', 'oracle'],
  ['FLOOR (seed order)', 'initial_seed'],
]) {
  const res = run(
    base({ functions: { ...base().functions, ranking: { code: pick('ranking', ranking) } } })
  )
  results[label] = { pairing: 'w40k_swiss', ranking, final: res.final, fairness: res.fairness, per_round: res.per_round }
}

console.log(`\nswept in ${((Date.now() - started) / 1000).toFixed(0)}s\n`)

// ---------------------------------------------------------------- tables

const METRICS = [
  ['kendall_tau', 'Kendall τ', 4],
  ['top1', 'winner right', 3],
  ['p_at_2', 'top-2', 3],
  ['p_at_8', 'top-8', 3],
  ['true_second_place', '#2 finished', 2],
  ['top8_displacement', 'top-8 err', 2],
  ['mean_displacement', 'mean err', 2],
]

const rows = Object.entries(results).map(([key, r]) => ({
  key,
  ...Object.fromEntries(METRICS.map(([m]) => [m, mean(r.final[m])])),
  ci: ci95(r.final.kendall_tau),
}))
rows.sort((a, b) => b.kendall_tau - a.kendall_tau)

console.log('ranked by Kendall τ (agreement with true skill)\n')
console.log(
  '  ' +
    'configuration'.padEnd(44) +
    METRICS.map(([, l]) => l.padStart(13)).join('') +
    '      ±95%'
)
for (const r of rows) {
  console.log(
    '  ' +
      r.key.padEnd(44) +
      METRICS.map(([m, , d]) => (Number.isFinite(r[m]) ? r[m].toFixed(d) : '—').padStart(13)).join('') +
      '   ' +
      r.ci.toFixed(4).padStart(7)
  )
}

const baselineKey = 'w40k_swiss | w40k_standings'
console.log(`\npaired difference in Kendall τ vs the real-world baseline (${baselineKey})\n`)
const bl = results[baselineKey].final.kendall_tau
const diffs = Object.entries(results)
  .filter(([k]) => k !== baselineKey && !k.startsWith('CEILING') && !k.startsWith('FLOOR'))
  .map(([k, r]) => ({ k, ...paired(r.final.kendall_tau, bl) }))
  .sort((a, b) => b.mean - a.mean)
for (const d of diffs) {
  const sig = Math.abs(d.mean) > d.ci ? '' : '   (not significant)'
  console.log(
    `  ${d.k.padEnd(44)} ${(d.mean >= 0 ? '+' : '') + d.mean.toFixed(4)} ± ${d.ci.toFixed(4)}${sig}`
  )
}

console.log('\nfairness of each pairing (identical across ranking functions)\n')
console.log('  ' + 'pairing'.padEnd(24) + 'rematches'.padStart(12) + 'mean BP gap'.padStart(14))
for (const p of PAIRINGS) {
  const r = results[`${p} | w40k_standings`]
  console.log(
    '  ' +
      p.padEnd(24) +
      mean(r.fairness.repeat_pairings).toFixed(2).padStart(12) +
      mean(r.fairness.mean_rating_gap).toFixed(1).padStart(14)
  )
}

if (OUT) {
  writeFileSync(
    OUT,
    JSON.stringify({ players: PLAYERS, rounds: ROUNDS, reps: REPS, seed: SEED, results }, null, 1)
  )
  console.log(`\nraw per-replication data → ${OUT}`)
}
