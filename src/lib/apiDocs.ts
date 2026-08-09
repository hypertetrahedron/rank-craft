import type { FunctionKind } from './simConfig'

/**
 * The contract shown beside every code editor. This is the single source of
 * truth for the documentation UI — keep it in step with public/py/harness.py.
 */

export type FieldDoc = { name: string; type: string; doc: string }
export type SectionDoc = { title: string; subtitle?: string; fields: FieldDoc[] }

export const PLAYER_FIELDS: FieldDoc[] = [
  { name: 'id', type: 'int', doc: 'Stable identifier. This is what you return from pairings and rankings.' },
  { name: 'name', type: 'str', doc: 'Display name, "P1" through "Pn".' },
  {
    name: 'skill',
    type: 'float',
    doc: 'TRUE skill — ground truth. Reading this from a pairing or ranking function is cheating; it exists so the `oracle` baseline can rank by it.',
  },
  { name: 'rating', type: 'float', doc: 'Public skill estimate. Starts at the seeding rating; your rating-update function owns it from there.' },
  { name: 'rating_dev', type: 'float', doc: 'Rating uncertainty, for systems that track it (Glicko). Starts at 350.' },
  { name: 'seed', type: 'int', doc: '1-based position from your seeding function.' },
  { name: 'score', type: 'float', doc: 'Cumulative points, summed from what play_match returned each round.' },
  { name: 'opponents', type: 'list[int | None]', doc: 'Opponent ids in round order. None marks a bye.' },
  { name: 'results', type: 'list[float]', doc: 'Points earned in each round, aligned with `opponents`.' },
  { name: 'colors', type: 'list[int]', doc: '+1 white, −1 black, 0 bye — one entry per round.' },
  { name: 'byes', type: 'int', doc: 'How many byes this player has taken.' },
  { name: 'floats', type: 'list[int]', doc: '+1 paired down a score group, −1 paired up, 0 paired level.' },
  { name: 'v_up / v_down', type: 'float', doc: 'This player’s maximum upward / downward skill swing, from step 2.' },
  {
    name: 'archetype',
    type: 'int',
    doc: 'Army, deck, playstyle — whatever makes matchups non-transitive. Unlike `skill` this is PUBLIC: you can see it across the table, so pairing and ranking functions may legitimately use it.',
  },
  { name: 'style', type: 'float', doc: 'The archetype as a position on a circle, in turns [0,1). Adjacent styles are similar.' },
  { name: 'stamina', type: 'float', doc: '1.0 means no late-round decline; lower means this player fades. Only meaningful when fatigue is switched on.' },
  { name: 'meta', type: 'dict', doc: 'Free scratch space. Persists across rounds — use it to carry your own state.' },
  { name: 'games', type: 'int (property)', doc: 'Rounds actually played, byes excluded.' },
  { name: 'color_balance()', type: '-> int', doc: 'Sum of `colors`. Positive means too much white.' },
]

export const TOURNAMENT_FIELDS: FieldDoc[] = [
  { name: 'players', type: 'dict[int, Player]', doc: 'Every player, keyed by id.' },
  { name: 'round', type: 'int', doc: '1-based round currently being paired or just played.' },
  { name: 'total_rounds', type: 'int', doc: 'Rounds in the tournament.' },
  { name: 'history', type: 'list[MatchRecord]', doc: 'Every match played so far, in order.' },
  { name: 'config', type: 'dict', doc: 'The full simulation config, if you need to branch on it.' },
  {
    name: 'standings()',
    type: '-> list[Player]',
    doc: 'Best first: score desc, rating desc, seed asc, id asc. Deterministic, and free of ground truth.',
  },
  { name: 'score_groups()', type: '-> dict[float, list[Player]]', doc: 'Players bucketed by score, top group first, best first within each.' },
  { name: 'have_played(a, b)', type: '-> bool', doc: 'Have these two met yet?' },
  { name: 'meetings(a, b)', type: '-> int', doc: 'How many times they have met.' },
  { name: 'opponents_of(pid)', type: '-> list[Player]', doc: 'Player objects this player has faced, byes skipped.' },
  {
    name: 'results_against(pid)',
    type: '-> list[(Player, float, float)]',
    doc: '(opponent, points you scored, points they scored) per round. The workhorse for tiebreaks.',
  },
  { name: 'color_balance(pid)', type: '-> int', doc: 'Shorthand for players[pid].color_balance().' },
  { name: 'max_score()', type: '-> float', doc: 'Highest score in the field right now.' },
  {
    name: 'wins(pid)',
    type: '-> float',
    doc: 'Match wins, a draw counting a half and a bye counting a win. Maintained by the harness — do not recompute it from the history.',
  },
  {
    name: 'bracket_key(p)',
    type: '-> float',
    doc: 'Whatever this tournament brackets on: match points, or the win record when step 1 is set to bracket by wins. `score_groups()` buckets on this.',
  },
]

export const MATCH_FIELDS: FieldDoc[] = [
  { name: 'round', type: 'int', doc: 'Round this was played in.' },
  { name: 'a / b', type: 'int / int | None', doc: 'Player ids. `a` had white; `b` is None for a bye.' },
  { name: 'skill_a / skill_b', type: 'float', doc: 'The effective skills actually used — base skill plus that match’s noise.' },
  { name: 'points_a / points_b', type: 'float', doc: 'What play_match returned.' },
  { name: 'is_bye', type: 'bool (property)', doc: 'True when b is None.' },
  { name: 'winner()', type: '-> int | None', doc: 'Higher-scoring player’s id, or None on a tie.' },
]

export const CTX_FIELDS: FieldDoc[] = [
  {
    name: 'ctx.rng',
    type: 'random.Random',
    doc: 'Seeded deterministically. Use this, never the bare `random` module, or your runs stop being reproducible.',
  },
  { name: 'ctx.round', type: 'int', doc: '1-based round number. 0 during seeding.' },
  { name: 'ctx.total_rounds', type: 'int', doc: 'Rounds in the tournament.' },
  { name: 'ctx.params', type: 'dict', doc: 'Values for the knobs you declared in PARAMS, after any UI override.' },
  { name: 'ctx.config', type: 'dict', doc: 'The full simulation config.' },
  { name: 'ctx.replication', type: 'int', doc: 'Which replication this is. Useful for debugging a specific run.' },
]

/** Only the outcome hook gets these — it is the one function that may see true skill. */
export const OUTCOME_CTX_FIELDS: FieldDoc[] = [
  {
    name: 'ctx.a / ctx.b',
    type: 'Player',
    doc: 'The two players themselves, in the same order as the skills you were handed. Enough to model an archetype matchup, a tiring player, or a leader who has already clinched and stops pressing.',
  },
  {
    name: 'ctx.tournament',
    type: 'Tournament',
    doc: 'Live standings and history, so the outcome can depend on what is at stake — the incentive to coast in the final round is real and only visible from here.',
  },
  {
    name: 'ctx.first',
    type: 'int | None',
    doc: 'Which player got the side advantage (going first), or None when sides are switched off. The harness has already applied it to the effective skills.',
  },
]

export const HELPERS: FieldDoc[] = [
  {
    name: 'max_weight_pairing(ids, weight_fn, allow_bye_for=None)',
    type: '-> list[(int, int)]',
    doc: 'Optimal pairing maximising the total of weight_fn(a, b), via Edmonds’ blossom algorithm. Weights are rounded to integers — scale yours up (×1000) rather than relying on fractions.',
  },
  {
    name: 'assign_colors(t, pairs)',
    type: '-> list[(int, int)]',
    doc: 'Re-orients each pair so whoever needs white most gets it. Use it as the last line of a pairing function.',
  },
  { name: 'pick_bye(t)', type: '-> int', doc: 'Lowest-ranked player who has not had a bye yet.' },
  {
    name: 'ridge_ratings(t, observe=None, ridge=1.0)',
    type: '-> dict[int, float]',
    doc: 'Maximum a posteriori skill estimates fitted to the whole result graph at once — Massey with a prior. The default observation is the score margin; pass `observe` to fit on win/loss instead, which is how you measure what the margin is worth with the estimator held constant.',
  },
  {
    name: 'posterior_spread(t, ids, noise, prior_sd)',
    type: '-> (matrix, index)',
    doc: 'Var(mu_i − mu_j) for every pair: what the tournament still does not know. Expected information gain is 0.5·log(1 + Var/noise²), so this is what an information-optimal pairing maximises.',
  },
  {
    name: 'matchup_bonus(a, b, cfg)',
    type: '-> float',
    doc: 'The non-transitive component `a` gains from facing `b`, as the harness computed it.',
  },
  { name: 'math, random, metrics', type: 'module', doc: 'Already imported. `metrics` has kendall_tau_b, spearman_rho and friends.' },
]

export type HookDoc = {
  kind: FunctionKind
  title: string
  signature: string
  summary: string
  /** Which reference sections matter for this hook, in order. */
  sections: SectionDoc[]
  contract: string[]
}

const playerSection: SectionDoc = { title: 'Player', fields: PLAYER_FIELDS }
const tournamentSection: SectionDoc = {
  title: 'Tournament (t)',
  subtitle: 'Live state. All of it is derived from results, not from true skill.',
  fields: TOURNAMENT_FIELDS,
}
const matchSection: SectionDoc = { title: 'MatchRecord', fields: MATCH_FIELDS }
const ctxSection: SectionDoc = { title: 'ctx', fields: CTX_FIELDS }
const helperSection: SectionDoc = {
  title: 'Helpers in scope',
  subtitle: 'No imports needed.',
  fields: HELPERS,
}

export const HOOK_DOCS: Record<FunctionKind, HookDoc> = {
  seeding: {
    kind: 'seeding',
    title: 'Seeding',
    signature: 'def seed_order(players: list[Player], ctx) -> list[int]',
    summary:
      'Decides the seeding table before round 1. The harness writes your ordering back as Player.seed, which round-1 pairings and every standings tiebreak read.',
    sections: [playerSection, ctxSection],
    contract: ['Return every player id exactly once.', 'Best seed first.'],
  },
  pairing: {
    kind: 'pairing',
    title: 'Pairing',
    signature: 'def pair_round(t: Tournament, ctx) -> list[tuple[int, int | None]]',
    summary:
      'Called once per round. Decide who plays whom. The first id in each pair gets white, the second black; pass None as the second to give a bye.',
    sections: [tournamentSection, playerSection, helperSection, ctxSection],
    contract: [
      'Every player appears in exactly one pairing.',
      'Exactly one bye when the field is odd, none when it is even.',
      'Nobody is paired against themselves.',
      'Rematches are allowed but counted — check t.have_played(a, b).',
    ],
  },
  outcome: {
    kind: 'outcome',
    title: 'Match outcome',
    signature: 'def play_match(skill_a: float, skill_b: float, ctx) -> tuple[float, float]',
    summary:
      'Turns two effective skills into two point totals. The skills you get already have this match’s random component applied — with zero variance they are the raw true skills, so the stronger player wins every time. The two numbers you return are the currency of the whole simulation: they become Player.score, they define the score groups the pairing function sees, and every tiebreak reads them.',
    sections: [
      { title: 'ctx, for the outcome hook', subtitle: 'Beyond the usual ctx fields.', fields: OUTCOME_CTX_FIELDS },
      playerSection,
      ctxSection,
    ],
    contract: [
      'Return exactly two numbers: (points_a, points_b).',
      'Any scale works — 1/0, 0.5/0.5, 3/1/0, or a margin.',
      'Draw randomness from ctx.rng if you need it.',
    ],
  },
  rating: {
    kind: 'rating',
    title: 'Rating update',
    signature: 'def update_ratings(t: Tournament, results: list[MatchRecord], ctx) -> None',
    summary:
      'Runs after every round with that round’s results. Mutate p.rating (and p.rating_dev) in place and return nothing. This is what makes rating-based pairing and rating-based ranking mean anything.',
    sections: [matchSection, tournamentSection, playerSection, ctxSection],
    contract: [
      'Mutate players in place; the return value is ignored.',
      'Byes appear in `results` with b = None — most systems skip them.',
    ],
  },
  ranking: {
    kind: 'ranking',
    title: 'Ranking',
    signature: 'def rank_players(t: Tournament, ctx) -> list[int]',
    summary:
      'Produces the standings. Called after EVERY round, not just the last — that is what makes the convergence curve measurable. ctx.round == ctx.total_rounds tells you it is the final call.',
    sections: [tournamentSection, playerSection, ctxSection],
    contract: ['Return every player id exactly once.', 'Best first.'],
  },
}
