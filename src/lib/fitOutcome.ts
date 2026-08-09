/**
 * Fitting the outcome model to a real event's results.
 *
 * Every finding this tool produces rests on an assumed map from skill gap to
 * score margin. That assumption is the largest caveat on all of it, and it is
 * the one caveat that real data can remove outright.
 *
 * The fit is the same Gaussian model the ranking functions use, run backwards:
 * given the observed margins, recover each player's latent skill by ridge
 * regression, then read off the parameters the simulator needs — where a typical
 * game lands, how much of a margin a point of skill buys, and how much of the
 * result the model cannot explain.
 */

export type ResultRow = { a: string; b: string; scoreA: number; scoreB: number; round?: number }

export type ParseOutcome = { rows: ResultRow[]; errors: string[] }

/**
 * Reads a results table. Column names are matched loosely because every event
 * software exports something different — "player_a"/"p1"/"player 1" all work.
 */
export function parseResultsCsv(text: string): ParseOutcome {
  const errors: string[] = []
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length < 2) return { rows: [], errors: ['Needs a header row and at least one result.'] }

  const delimiter = (lines[0].match(/\t/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? '\t' : ','
  const split = (line: string) => line.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ''))

  const header = split(lines[0]).map((h) => h.toLowerCase().replace(/[\s_-]/g, ''))
  const find = (...names: string[]) => header.findIndex((h) => names.includes(h))

  const ia = find('playera', 'player1', 'p1', 'a', 'player', 'name')
  const ib = find('playerb', 'player2', 'p2', 'b', 'opponent')
  const isa = find('scorea', 'score1', 'points1', 'pointsa', 'vp1', 'score')
  const isb = find('scoreb', 'score2', 'points2', 'pointsb', 'vp2', 'opponentscore')
  const ir = find('round', 'rd', 'r')

  if (ia < 0 || ib < 0 || isa < 0 || isb < 0) {
    return {
      rows: [],
      errors: [
        'Could not find the columns. Expected something like: player_a, player_b, score_a, score_b (round optional).',
        `Saw: ${split(lines[0]).join(', ')}`,
      ],
    }
  }

  const rows: ResultRow[] = []
  lines.slice(1).forEach((line, i) => {
    const cells = split(line)
    const scoreA = Number(cells[isa])
    const scoreB = Number(cells[isb])
    if (!cells[ia] || !cells[ib]) {
      errors.push(`Row ${i + 2}: missing a player name.`)
      return
    }
    if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB)) {
      errors.push(`Row ${i + 2}: scores are not numbers ("${cells[isa]}", "${cells[isb]}").`)
      return
    }
    if (cells[ia] === cells[ib]) {
      errors.push(`Row ${i + 2}: a player cannot play themselves.`)
      return
    }
    rows.push({
      a: cells[ia],
      b: cells[ib],
      scoreA,
      scoreB,
      round: ir >= 0 ? Number(cells[ir]) || undefined : undefined,
    })
  })

  return { rows, errors }
}

export type OutcomeFit = {
  players: number
  games: number
  /** Where an evenly matched game lands — the model's `par_score`. */
  parScore: number
  /**
   * Spread of the fitted player strengths, in score units.
   *
   * Note what is *not* here: a separate "points per unit of skill". Skill and
   * that slope are not separately identifiable from margins alone — doubling
   * every skill and halving the slope predicts exactly the same games. Only the
   * spread of the strengths, in the units of the scoreboard, is a fact about the
   * event; the rating axis is a presentation choice made in `fitToConfig`.
   */
  skillSd: number
  /** Residual spread the skill model cannot explain, in score points. */
  noise: number
  /** Fraction of the variance in margins the skill model does explain. */
  rSquared: number
  /** How often the higher-rated player actually won. */
  favouriteWinRate: number
  /** Share of games that hit the scoreboard ceiling or floor. */
  saturatedShare: number
  scoreMin: number
  scoreMax: number
  drawRate: number
}

/**
 * Ridge regression of margin on the player indicators, then a variance
 * decomposition. Ridge rather than plain least squares because a real event's
 * comparison graph is sparse and an undefeated player would otherwise take an
 * infinite rating.
 */
export function fitOutcomeModel(rows: ResultRow[], ridge = 1): OutcomeFit | null {
  if (rows.length < 4) return null

  const names = [...new Set(rows.flatMap((r) => [r.a, r.b]))]
  const idx = new Map(names.map((n, i) => [n, i]))
  const n = names.length

  // (L + ridge·I) mu = net margin — the same normal equations ridge_ratings solves
  const A: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? ridge : 0))
  )
  const b = new Array<number>(n).fill(0)
  for (const r of rows) {
    const i = idx.get(r.a)!
    const j = idx.get(r.b)!
    const m = r.scoreA - r.scoreB
    A[i][i] += 1
    A[j][j] += 1
    A[i][j] -= 1
    A[j][i] -= 1
    b[i] += m
    b[j] -= m
  }
  const mu = solve(A, b)
  if (!mu) return null

  // Slope of observed margin on estimated skill gap, through the origin: the
  // model is antisymmetric, so a constant term would be meaningless. Ridge
  // shrinks the strengths, and this slope is what undoes that shrinkage — it is
  // a normalisation, not a finding.
  let num = 0
  let den = 0
  for (const r of rows) {
    const gap = mu[idx.get(r.a)!] - mu[idx.get(r.b)!]
    num += gap * (r.scoreA - r.scoreB)
    den += gap * gap
  }
  const slope = den > 0 ? num / den : 0

  let ssRes = 0
  let ssTot = 0
  for (const r of rows) {
    const gap = mu[idx.get(r.a)!] - mu[idx.get(r.b)!]
    const predicted = slope * gap
    const actual = r.scoreA - r.scoreB
    ssRes += (actual - predicted) ** 2
    ssTot += actual ** 2 // mean margin is zero by antisymmetry
  }

  // Strengths on the scoreboard's own scale, which is the identifiable quantity.
  const scaled = mu.map((v) => v * slope)
  const meanMu = scaled.reduce((a, v) => a + v, 0) / n
  const skillSd = Math.sqrt(scaled.reduce((a, v) => a + (v - meanMu) ** 2, 0) / Math.max(1, n - 1))

  const scores = rows.flatMap((r) => [r.scoreA, r.scoreB])
  const scoreMin = Math.min(...scores)
  const scoreMax = Math.max(...scores)
  const favouriteWins = rows.filter((r) => {
    const gap = mu[idx.get(r.a)!] - mu[idx.get(r.b)!]
    return gap === 0 ? false : gap > 0 === r.scoreA > r.scoreB
  }).length
  const decisive = rows.filter((r) => r.scoreA !== r.scoreB).length

  return {
    players: n,
    games: rows.length,
    parScore: scores.reduce((s, v) => s + v, 0) / scores.length,
    skillSd,
    noise: Math.sqrt(ssRes / Math.max(1, rows.length - 1)),
    rSquared: ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0,
    favouriteWinRate: decisive > 0 ? favouriteWins / decisive : 0,
    saturatedShare:
      scores.filter((v) => v <= scoreMin + 1e-9 || v >= scoreMax - 1e-9).length / scores.length,
    scoreMin,
    scoreMax,
    drawRate: (rows.length - decisive) / rows.length,
  }
}

/**
 * The fit expressed in the simulator's own terms.
 *
 * A real event gives margins against *estimated* skill, whose scale is the score
 * itself. Rescaling onto the familiar 1400–2200 rating axis keeps the rest of
 * the UI — the histogram, the variance sliders — reading in units people
 * recognise.
 */
export function fitToConfig(
  fit: OutcomeFit,
  ratingSpan = 800
): {
  parScore: number
  pointsPerSkill: number
  varianceRating: number
  ratingSd: number
} {
  // The rating axis is ours to choose; we pick one four standard deviations
  // wide so the familiar 1400-2200 range covers the field. What the data fixes
  // is the *ratio* between the spread of strength and the spread of margins.
  const ratingSd = ratingSpan / 4
  const pointsPerSkill = fit.skillSd > 0 ? fit.skillSd / ratingSd : 0.05

  // Residual score noise, converted back into the per-player skill swing that
  // would reproduce it. Two independent players contribute to one margin, and
  // the clamped-normal shape has sd ≈ v/3.
  const perPlayerNoise = fit.noise / Math.SQRT2
  const varianceRating = pointsPerSkill > 0 ? (3 * perPlayerNoise) / pointsPerSkill : 0

  return {
    parScore: Math.round(fit.parScore),
    pointsPerSkill: Number(pointsPerSkill.toFixed(4)),
    varianceRating: Math.round(varianceRating),
    ratingSd: Math.round(ratingSd),
  }
}

/** Gaussian elimination with partial pivoting. Null when the system is singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
    if (Math.abs(M[piv][col]) < 1e-12) return null
    ;[M[col], M[piv]] = [M[piv], M[col]]
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col]
      if (!f) continue
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n]
    for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c]
    x[r] = s / M[r][r]
  }
  return x
}
