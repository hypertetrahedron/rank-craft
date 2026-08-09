import type { FairnessMetric, FinalMetric, RoundMetric } from './pyodide/protocol'

export type MetricMeta = {
  label: string
  /** One line explaining what the number means, shown under the value. */
  blurb: string
  digits: number
  /** Which direction is better — drives the arrow on a comparison. */
  better: 'high' | 'low' | 'none'
  /** Headline metrics get a large card; the rest go in the table. */
  headline?: boolean
  format?: (v: number) => string
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

export const FINAL_META: Record<FinalMetric, MetricMeta> = {
  kendall_tau: {
    label: 'Kendall τ',
    blurb:
      'Agreement between the final standings and true skill, over every pair of players. 1.0 is perfect, 0 is a coin flip. The reference measure in the Swiss-system literature.',
    digits: 4,
    better: 'high',
    headline: true,
  },
  spearman: {
    label: 'Spearman ρ',
    blurb:
      'The same question weighted by how far apart players are, so a swap at the top costs more than one in the middle.',
    digits: 4,
    better: 'high',
    headline: true,
  },
  top1: {
    label: 'Right winner',
    blurb: 'How often the genuinely strongest player finished first.',
    digits: 3,
    better: 'high',
    headline: true,
    format: pct,
  },
  rounds_to_95: {
    label: 'Rounds to 95%',
    blurb:
      'The round at which the ranking first reached 95% of the accuracy it would finish with. Everything after it is largely confirmation. Measured against this configuration’s own ceiling, so it says nothing about how good that ceiling is — a bad strategy can reach its own limit quickly.',
    digits: 2,
    // Deliberately not "low": the target is self-relative, so a lower number
    // across two configurations does not mean better. Marking a winner here
    // would reward converging fast on a worse answer.
    better: 'none',
    headline: true,
  },
  kendall_distance: {
    label: 'Pairs out of order',
    blurb: 'Fraction of player pairs the standings got backwards. 0 is perfect.',
    digits: 4,
    better: 'low',
  },
  p_at_2: {
    label: 'Top 2 overlap',
    blurb: 'How much of the true top 2 finished in the top 2 — the final-table question.',
    digits: 3,
    better: 'high',
    format: pct,
  },
  true_second_place: {
    label: 'Where the true #2 finished',
    blurb:
      'Average finishing position of the genuinely second-best player. Anything well above 2 means the format is punishing them for who they were drawn against rather than for how they played.',
    digits: 2,
    better: 'low',
  },
  top8_displacement: {
    label: 'Top 8 rank error',
    blurb:
      'Mean placement error over the true top 8 — the part of the table the event is actually deciding. Errors at table 40 cost nobody anything.',
    digits: 2,
    better: 'low',
  },
  p_at_3: {
    label: 'Podium overlap',
    blurb: 'How much of the true top 3 landed in the finishing top 3.',
    digits: 3,
    better: 'high',
    format: pct,
  },
  p_at_8: {
    label: 'Top 8 overlap',
    blurb: 'The number that matters when the tournament is a qualifier.',
    digits: 3,
    better: 'high',
    format: pct,
  },
  p_at_decile: {
    label: 'Top decile overlap',
    blurb: 'Top 10% of the field, recovered. Scales with the field size.',
    digits: 3,
    better: 'high',
    format: pct,
  },
  ndcg_at_10: {
    label: 'NDCG@10',
    blurb:
      'Rewards putting genuinely strong players near the top and discounts by position — the ranking-quality measure from information retrieval.',
    digits: 4,
    better: 'high',
  },
  cut_winner_is_best: {
    label: 'Right champion',
    blurb:
      'How often the genuinely strongest player won the single-elimination cut. The question a top cut actually asks — a blunt Swiss that seeds the bracket wrong hands the trophy to somebody else however good its tau was.',
    digits: 3,
    better: 'high',
    format: pct,
  },
  cut_winner_true_rank: {
    label: 'Champion’s true rank',
    blurb: 'Where the eventual champion really belonged. 1.00 means the best player always won.',
    digits: 2,
    better: 'low',
  },
  cut_field_quality: {
    label: 'Cut field quality',
    blurb:
      'How much of the true top N made the cut. Separates “the bracket was seeded from the right players” from “the bracket produced the right winner”.',
    digits: 3,
    better: 'high',
    format: pct,
  },
  mean_displacement: {
    label: 'Mean rank error',
    blurb: 'Average distance between where a player finished and where they belonged.',
    digits: 2,
    better: 'low',
  },
  max_displacement: {
    label: 'Worst rank error',
    blurb: 'The single most misplaced player. The complaint you will actually receive.',
    digits: 2,
    better: 'low',
  },
}

export const FAIRNESS_META: Record<FairnessMetric, MetricMeta> = {
  repeat_pairings: {
    label: 'Rematches',
    blurb: 'Pairs forced to meet twice. Swiss rules forbid this; a strategy that needs it is cheating on fairness to buy accuracy.',
    digits: 2,
    better: 'low',
  },
  floaters_per_player: {
    label: 'Floats per player',
    blurb: 'How often a player was pulled out of their score group to make the round pair up.',
    digits: 2,
    better: 'low',
  },
  mean_color_imbalance: {
    label: 'Mean colour imbalance',
    blurb: 'Average |whites − blacks|. Zero means everyone alternated cleanly.',
    digits: 2,
    better: 'low',
  },
  max_color_imbalance: {
    label: 'Worst colour imbalance',
    blurb: 'The most lopsided player. Above 2 would draw a protest in a real event.',
    digits: 2,
    better: 'low',
  },
  max_byes: {
    label: 'Most byes given',
    blurb: 'Byes handed to a single player. More than one is unfair on an odd field.',
    digits: 2,
    better: 'low',
  },
  mean_rating_gap: {
    label: 'Mean rating gap',
    blurb: 'Average rating difference inside a pairing. Low means players faced their equals.',
    digits: 1,
    better: 'low',
  },
}

export const ROUND_META: Record<RoundMetric, MetricMeta> = {
  tau_vs_true: {
    label: 'Accuracy (τ vs true skill)',
    blurb: 'How well the standings matched true skill after each round.',
    digits: 4,
    better: 'high',
  },
  tau_vs_final: {
    label: 'Settledness (τ vs final)',
    blurb:
      'How close each round was to the order the tournament finished with. Reaching 1.0 early means the last rounds changed nothing.',
    digits: 4,
    better: 'high',
  },
  spearman_vs_true: {
    label: 'Spearman vs true skill',
    blurb: 'The distance-weighted version of the accuracy curve.',
    digits: 4,
    better: 'high',
  },
  churn: {
    label: 'Rank churn',
    blurb: 'Average places a player moved from the previous round. Falls as the field settles.',
    digits: 2,
    better: 'none',
  },
  top1: {
    label: 'Right leader',
    blurb: 'How often the true best player was top of the table after this round.',
    digits: 3,
    better: 'high',
  },
}

export const HEADLINE_METRICS = (Object.keys(FINAL_META) as FinalMetric[]).filter(
  (m) => FINAL_META[m].headline
)
