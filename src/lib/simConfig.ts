import { z } from 'zod'

/**
 * The whole wizard state, in one schema. This object is what gets JSON-encoded
 * and handed to the Python harness, what gets saved to the database as a
 * config, and what the URL round-trips — so it is the single source of truth.
 */

export const FUNCTION_KINDS = ['seeding', 'pairing', 'outcome', 'rating', 'ranking'] as const
export type FunctionKind = (typeof FUNCTION_KINDS)[number]

export const skillSchema = z.object({
  // Every field carries a default so `simConfigSchema.parse({})` yields a
  // runnable configuration — which is what makes the schema usable as the
  // single source of truth for defaults, tests and URL round-tripping.
  kind: z.enum(['normal', 'uniform', 'linear', 'bimodal', 'custom']).default('uniform'),
  mean: z.number().default(1600),
  stdev: z.number().min(0).default(200),
  min: z.number().default(1400),
  max: z.number().default(2200),
  values: z.array(z.number()).default([]),
})

export const varianceSchema = z.object({
  /** Shape of the per-match noise. `uniform` treats max_up/max_down as hard bounds. */
  kind: z.enum(['uniform', 'normal', 'triangular']).default('uniform'),
  max_up: z.number().min(0).default(100),
  max_down: z.number().min(0).default(100),
  /** 0 = every player equally noisy. 1 = the strongest player has no noise at all. */
  skill_coupling: z.number().min(0).max(1).default(0),
  exponent: z.number().min(0.1).max(5).default(1),
})

export const initialRatingSchema = z.object({
  /**
   * How well the seeding rating knows true skill before a game is played.
   *
   * `true` is a trap, and the default is deliberately not it: with a perfect
   * seeding rating, seed order *is* true skill order, and every ranking
   * function tiebreaks on seed — so ground truth leaks straight into the
   * standings and accuracy is near 1.0 after round one. Offered because
   * "ratings are perfect" is a legitimate thing to model, but flagged in the UI.
   */
  mode: z.enum(['true', 'noisy', 'flat']).default('noisy'),
  noise: z.number().min(0).default(120),
  value: z.number().default(1500),
})

/**
 * Non-transitive matchups. Archetypes sit evenly on a circle and the bonus one
 * gains against another is antisymmetric, so with three archetypes it is
 * literally rock-paper-scissors. This is the one effect that breaks the premise
 * every rating system rests on — that players can be placed on a single line.
 */
export const matchupSchema = z.object({
  kind: z.enum(['none', 'circular']).default('none'),
  archetypes: z.number().int().min(1).max(12).default(3),
  /** Skill swing from the matchup alone, in the same units as skill. */
  amplitude: z.number().min(0).default(0),
})

/** Going first. In 40k it is decided at the table, not by the pairing. */
export const sideSchema = z.object({
  mode: z.enum(['none', 'pairing', 'random']).default('none'),
  advantage: z.number().min(0).default(0),
})

/** Late-round decline, heterogeneous so it changes the ranking rather than shifting it. */
export const fatigueSchema = z.object({
  /** Skill lost per round by a player with zero stamina. */
  amplitude: z.number().min(0).default(0),
  /** Spread of stamina across the field. 0 means everyone is equally fresh. */
  spread: z.number().min(0).max(1).default(0),
})

export const functionRefSchema = z.object({
  /** Display name; ignored by the engine. */
  name: z.string().default('custom'),
  /** Set when the code came from a saved or built-in function, for the picker. */
  sourceId: z.string().nullable().default(null),
  code: z.string(),
  params: z.record(z.union([z.number(), z.string(), z.boolean()])).default({}),
})

export const simConfigSchema = z.object({
  players: z.number().int().min(2).max(512).default(32),
  rounds: z.number().int().min(1).max(30).default(7),
  replications: z.number().int().min(1).max(20000).default(500),
  seed: z.number().int().min(0).default(12345),
  /** Points awarded for a bye. 1.0 is a full win, the FIDE default. */
  bye_points: z.number().default(1),
  /**
   * What a Swiss bracket is made of. `score` buckets by accumulated points;
   * `wins` buckets by match record. Identical in chess, completely different in
   * a game scored 0–100 a side, where every player's total is unique and a
   * score bucket would hold exactly one person.
   */
  bracket_by: z.enum(['score', 'wins']).default('score'),
  /** Single-elimination bracket over the top N after the Swiss rounds. 0 = none. */
  top_cut: z.number().int().min(0).max(64).default(0),
  // Every model block defaults to "switched off", so a config only has to name
  // what it changes — which is what lets the URL carry a diff instead of the
  // whole object, and lets a test build one from `{}`.
  skill: skillSchema.default({}),
  variance: varianceSchema.default({}),
  matchup: matchupSchema.default({}),
  side: sideSchema.default({}),
  fatigue: fatigueSchema.default({}),
  initial_rating: initialRatingSchema.default({}),
  functions: z.object({
    seeding: functionRefSchema,
    pairing: functionRefSchema,
    outcome: functionRefSchema,
    rating: functionRefSchema,
    ranking: functionRefSchema,
  }),
})

export type SimConfig = z.infer<typeof simConfigSchema>
export type FunctionRef = z.infer<typeof functionRefSchema>
export type SkillSpec = z.infer<typeof skillSchema>
export type VarianceSpec = z.infer<typeof varianceSchema>

/** What actually crosses into Python, with the slice this worker should run. */
export type EngineConfig = SimConfig & {
  replication_ids: number[]
  want_log: boolean
}

/** Recommended round count: enough for a single undefeated player to emerge. */
export function recommendedRounds(players: number): number {
  return Math.max(1, Math.ceil(Math.log2(Math.max(2, players))))
}

/** Total simulated matches — the number that decides whether a run is seconds or minutes. */
export function matchCount(cfg: Pick<SimConfig, 'players' | 'rounds' | 'replications'>): number {
  return Math.floor(cfg.players / 2) * cfg.rounds * cfg.replications
}

export function skillRange(s: SkillSpec): [number, number] {
  if (s.kind === 'normal') return [s.mean - 3 * s.stdev, s.mean + 3 * s.stdev]
  if (s.kind === 'custom') {
    if (!s.values.length) return [0, 1]
    return [Math.min(...s.values), Math.max(...s.values)]
  }
  return [s.min, s.max]
}

/** Sample the configured distribution for the live histogram in step 2. */
export function sampleSkills(s: SkillSpec, n: number, seed = 1): number[] {
  const rng = mulberry32(seed)
  const gauss = () => {
    // Box-Muller
    const u = Math.max(1e-12, rng())
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
  }
  if (s.kind === 'normal') return Array.from({ length: n }, () => s.mean + s.stdev * gauss())
  if (s.kind === 'uniform') return Array.from({ length: n }, () => s.min + rng() * (s.max - s.min))
  if (s.kind === 'linear')
    return Array.from({ length: n }, (_, i) =>
      n === 1 ? s.max : s.min + (i * (s.max - s.min)) / (n - 1)
    )
  if (s.kind === 'bimodal')
    return Array.from({ length: n }, (_, i) => (i % 2 === 0 ? s.max : s.min) + s.stdev * gauss())
  if (!s.values.length) return []
  return Array.from({ length: n }, (_, i) => s.values[i % s.values.length])
}

/** Per-player swing limits — mirrors `_variance_for` in harness.py. */
export function varianceFor(
  skill: number,
  lo: number,
  hi: number,
  v: VarianceSpec
): [number, number] {
  const span = hi - lo
  const norm = span <= 0 ? 0 : (skill - lo) / span
  const damp = Math.pow(Math.max(0, 1 - v.skill_coupling * norm), v.exponent)
  return [Math.max(0, v.max_up * damp), Math.max(0, v.max_down * damp)]
}

/**
 * Probability the stronger of two players wins under uniform noise, used for the
 * step-2 preview. Both draw independently from their own swing range; this is
 * P(skill_a + n_a > skill_b + n_b) by numeric integration over n_a.
 */
export function pStrongerWins(
  skillA: number,
  skillB: number,
  vA: [number, number],
  vB: [number, number],
  steps = 400
): number {
  const [upA, downA] = vA
  const [upB, downB] = vB
  const spanA = upA + downA
  const spanB = upB + downB
  if (spanA === 0 && spanB === 0) return skillA > skillB ? 1 : skillA < skillB ? 0 : 0.5

  const cdfB = (x: number) => {
    // P(skill_b + n_b <= x), n_b ~ U(-downB, +upB)
    if (spanB === 0) return x >= skillB ? 1 : 0
    const t = (x - (skillB - downB)) / spanB
    return Math.min(1, Math.max(0, t))
  }
  if (spanA === 0) return cdfB(skillA)

  let acc = 0
  for (let i = 0; i < steps; i++) {
    const x = skillA - downA + ((i + 0.5) / steps) * spanA
    acc += cdfB(x)
  }
  return acc / steps
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Placeholder code, replaced by the real built-ins once they load. */
const stub = (kind: FunctionKind): FunctionRef => ({
  name: 'loading',
  sourceId: null,
  code: `# loading ${kind}...`,
  params: {},
})

/**
 * The starting configuration, and the reference point a shareable link is a
 * diff against. Lives with the schema rather than in the React store so that
 * anything needing it — the URL codec, tests — does not pull in zustand.
 */
export function defaultConfig(): SimConfig {
  return simConfigSchema.parse({
    players: 32,
    rounds: recommendedRounds(32),
    replications: 300,
    seed: 12345,
    bye_points: 1,
    skill: { kind: 'uniform', min: 1400, max: 2200 },
    variance: { kind: 'uniform', max_up: 100, max_down: 100, skill_coupling: 0, exponent: 1 },
    initial_rating: { mode: 'noisy', noise: 120 },
    functions: Object.fromEntries(FUNCTION_KINDS.map((k) => [k, stub(k)])),
  })
}
