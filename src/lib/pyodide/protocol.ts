/** Message contract between the main thread and a simulation worker. */

export const PYODIDE_VERSION = '0.26.4'
export const PYODIDE_URL =
  process.env.NEXT_PUBLIC_PYODIDE_URL || `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

/**
 * Wheels served from public/ and installed by URL, which skips Pyodide's
 * dependency resolution. Only fetched when the selected functions actually
 * import them — together they are 15 MB, and most configurations need neither.
 */
export const WHEELS: { module: string; url: string; mb: number }[] = [
  { module: 'networkx', url: '/py/wheels/networkx-3.3-py3-none-any.whl', mb: 3.6 },
  {
    module: 'numpy',
    url: '/py/wheels/numpy-1.26.4-cp312-cp312-pyodide_2024_0_wasm32.whl',
    mb: 11.4,
  },
]

export type PySources = { harness: string; metrics: string }

export type WorkerIn =
  | { type: 'init'; pyodideUrl: string; sources: PySources; wheels: string[] }
  | { type: 'run'; runId: string; config: string }

export type WorkerOut =
  | { type: 'status'; stage: InitStage }
  | { type: 'ready' }
  | { type: 'initError'; error: string }
  | { type: 'progress'; runId: string; done: number; total: number }
  | { type: 'result'; runId: string; payload: BatchResult }
  | { type: 'error'; runId: string; error: string; trace?: string }

export type InitStage = 'loading-runtime' | 'loading-packages' | 'loading-harness'

// --------------------------------------------------------------------------
// results
// --------------------------------------------------------------------------

/** A metric value the engine could not define — round 1 churn, tau on an all-tied ranking. */
export type Maybe = number | null

export type FinalMetric =
  | 'kendall_tau'
  | 'spearman'
  | 'kendall_distance'
  | 'top1'
  | 'p_at_2'
  | 'p_at_3'
  | 'p_at_8'
  | 'p_at_decile'
  | 'ndcg_at_10'
  | 'mean_displacement'
  | 'max_displacement'
  | 'true_second_place'
  | 'top8_displacement'
  | 'rounds_to_95'
  | 'cut_winner_true_rank'
  | 'cut_winner_is_best'
  | 'cut_field_quality'

export type FairnessMetric =
  | 'repeat_pairings'
  | 'floaters_per_player'
  | 'mean_color_imbalance'
  | 'max_color_imbalance'
  | 'max_byes'
  | 'mean_rating_gap'

export type RoundMetric = 'tau_vs_true' | 'spearman_vs_true' | 'tau_vs_final' | 'churn' | 'top1'

export type SampleMatch = {
  a: number
  b: number | null
  skill_a: Maybe
  skill_b: Maybe
  points_a: number
  points_b: number
}

export type SampleTournament = {
  log: { round: number; matches: SampleMatch[]; ranking: number[] }[]
  field: {
    id: number
    name: string
    skill: number
    rating: number
    seed: number
    score: number
    v_up: number
    v_down: number
  }[]
  truth: number[]
  final_order: number[]
}

/** Raw per-replication values. Aggregation happens on the main thread so that
 *  worker slices merge cleanly and compare mode can run paired tests. */
export type BatchResult = {
  ok: true
  version: string
  replication_ids: number[]
  final: Record<FinalMetric, Maybe[]>
  fairness: Record<FairnessMetric, Maybe[]>
  /** [replication][round] */
  per_round: Record<RoundMetric, Maybe[][]>
  sample: SampleTournament | null
}

export type BatchError = { ok: false; error: string; replication?: number; trace?: string }

export type BatchResponse = BatchResult | BatchError

export const FINAL_METRICS: FinalMetric[] = [
  'kendall_tau',
  'spearman',
  'kendall_distance',
  'top1',
  'p_at_2',
  'p_at_3',
  'p_at_8',
  'p_at_decile',
  'ndcg_at_10',
  'mean_displacement',
  'max_displacement',
  'true_second_place',
  'top8_displacement',
  'rounds_to_95',
  'cut_winner_true_rank',
  'cut_winner_is_best',
  'cut_field_quality',
]

export const FAIRNESS_METRICS: FairnessMetric[] = [
  'repeat_pairings',
  'floaters_per_player',
  'mean_color_imbalance',
  'max_color_imbalance',
  'max_byes',
  'mean_rating_gap',
]

export const ROUND_METRICS: RoundMetric[] = [
  'tau_vs_true',
  'spearman_vs_true',
  'tau_vs_final',
  'churn',
  'top1',
]
