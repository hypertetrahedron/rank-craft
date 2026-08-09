import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fitOutcomeModel, fitToConfig, parseResultsCsv, type ResultRow } from './fitOutcome.ts'

describe('parseResultsCsv', () => {
  it('reads a plain CSV', () => {
    const { rows, errors } = parseResultsCsv('player_a,player_b,score_a,score_b\nAda,Bram,84,71')
    assert.deepEqual(errors, [])
    assert.deepEqual(rows, [{ a: 'Ada', b: 'Bram', scoreA: 84, scoreB: 71, round: undefined }])
  })

  it('accepts the many names event software uses for the same column', () => {
    for (const header of [
      'player1,player2,score1,score2',
      'p1,p2,points1,points2',
      'Player A,Player B,Score A,Score B',
      'player_a\tplayer_b\tvp1\tvp2',
    ]) {
      const sep = header.includes('\t') ? '\t' : ','
      const { rows, errors } = parseResultsCsv(`${header}\nAda${sep}Bram${sep}84${sep}71`)
      assert.equal(rows.length, 1, `${header} -> ${errors.join('; ')}`)
      assert.equal(rows[0].scoreA, 84)
    }
  })

  it('reads an optional round column', () => {
    const { rows } = parseResultsCsv('player_a,player_b,score_a,score_b,round\nAda,Bram,84,71,3')
    assert.equal(rows[0].round, 3)
  })

  it('strips quotes and tolerates spacing', () => {
    const { rows } = parseResultsCsv('player_a,player_b,score_a,score_b\n"Ada Lovelace" , Bram , 84 , 71')
    assert.equal(rows[0].a, 'Ada Lovelace')
    assert.equal(rows[0].scoreB, 71)
  })

  it('reports the columns it saw when it cannot find them', () => {
    const { rows, errors } = parseResultsCsv('who,whom,what\nAda,Bram,84')
    assert.equal(rows.length, 0)
    assert.match(errors.join(' '), /Could not find the columns/)
    assert.match(errors.join(' '), /who, whom, what/)
  })

  it('skips bad rows without discarding good ones', () => {
    const { rows, errors } = parseResultsCsv(
      ['player_a,player_b,score_a,score_b', 'Ada,Bram,84,71', 'Cato,Dara,n/a,90', 'Eve,Eve,50,50', 'Finn,Gus,60,62'].join('\n')
    )
    assert.equal(rows.length, 2)
    assert.equal(errors.length, 2)
    assert.match(errors[0], /not numbers/)
    assert.match(errors[1], /cannot play themselves/)
  })

  it('needs more than a header', () => {
    assert.equal(parseResultsCsv('player_a,player_b,score_a,score_b').rows.length, 0)
    assert.equal(parseResultsCsv('').rows.length, 0)
  })
})

describe('fitOutcomeModel', () => {
  /** Games generated from known skills with a known slope and no noise. */
  const synthetic = (slope: number, noise = 0): ResultRow[] => {
    const skills: Record<string, number> = { A: 30, B: 10, C: -5, D: -35 }
    const names = Object.keys(skills)
    const rows: ResultRow[] = []
    let seed = 1
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648 - 0.5
    }
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        for (let rep = 0; rep < 4; rep++) {
          const margin = slope * (skills[names[i]] - skills[names[j]]) + noise * rand()
          rows.push({ a: names[i], b: names[j], scoreA: 75 + margin / 2, scoreB: 75 - margin / 2 })
        }
      }
    }
    return rows
  }

  it('recovers a noiseless linear relationship', () => {
    const fit = fitOutcomeModel(synthetic(1))!
    assert.equal(fit.players, 4)
    assert.equal(fit.games, 24)
    assert.ok(Math.abs(fit.parScore - 75) < 1e-6, `par ${fit.parScore}`)
    assert.ok(fit.rSquared > 0.99, `R² ${fit.rSquared}`)
    assert.ok(fit.noise < 1e-6, `noise ${fit.noise}`)
    assert.equal(fit.favouriteWinRate, 1)
  })

  it('reports a lower R² and higher noise as the results get noisier', () => {
    const clean = fitOutcomeModel(synthetic(1, 0))!
    const noisy = fitOutcomeModel(synthetic(1, 60))!
    assert.ok(noisy.rSquared < clean.rSquared)
    assert.ok(noisy.noise > clean.noise)
  })

  it('reports strength spread on the scoreboard scale, which is what is identifiable', () => {
    // Skill and the slope are not separately identifiable from margins: halving
    // every skill and doubling the slope predicts the same games. What is fixed
    // by the data is the spread of strength measured in score points.
    const weak = fitOutcomeModel(synthetic(0.2))!
    const strong = fitOutcomeModel(synthetic(1.0))!
    assert.ok(
      strong.skillSd > weak.skillSd * 3,
      `a five-fold stronger skill effect should widen the spread: ${weak.skillSd} vs ${strong.skillSd}`
    )
  })

  it('turns a stronger skill effect into a lower implied randomness', () => {
    const weak = fitToConfig(fitOutcomeModel(synthetic(0.2, 25))!)
    const strong = fitToConfig(fitOutcomeModel(synthetic(1.0, 25))!)
    assert.ok(
      strong.varianceRating < weak.varianceRating,
      `${strong.varianceRating} should be below ${weak.varianceRating}`
    )
  })

  it('counts draws and saturated games', () => {
    const rows: ResultRow[] = [
      { a: 'A', b: 'B', scoreA: 50, scoreB: 50 },
      { a: 'C', b: 'D', scoreA: 100, scoreB: 0 },
      { a: 'A', b: 'C', scoreA: 60, scoreB: 40 },
      { a: 'B', b: 'D', scoreA: 55, scoreB: 45 },
    ]
    const fit = fitOutcomeModel(rows)!
    assert.equal(fit.drawRate, 0.25)
    assert.equal(fit.scoreMin, 0)
    assert.equal(fit.scoreMax, 100)
    assert.ok(fit.saturatedShare > 0)
  })

  it('declines to fit too little data', () => {
    assert.equal(fitOutcomeModel([{ a: 'A', b: 'B', scoreA: 1, scoreB: 0 }]), null)
    assert.equal(fitOutcomeModel([]), null)
  })

  it('survives a completely disconnected set of players', () => {
    // ridge is what keeps this solvable at all
    const fit = fitOutcomeModel([
      { a: 'A', b: 'B', scoreA: 80, scoreB: 70 },
      { a: 'C', b: 'D', scoreA: 80, scoreB: 70 },
      { a: 'E', b: 'F', scoreA: 80, scoreB: 70 },
      { a: 'G', b: 'H', scoreA: 80, scoreB: 70 },
    ])
    assert.ok(fit, 'a disconnected graph should still produce a fit')
    assert.equal(fit!.players, 8)
  })
})

describe('fitToConfig', () => {
  it('produces settings the simulator can use', () => {
    const fit = fitOutcomeModel([
      { a: 'A', b: 'B', scoreA: 90, scoreB: 60 },
      { a: 'B', b: 'C', scoreA: 80, scoreB: 70 },
      { a: 'A', b: 'C', scoreA: 95, scoreB: 55 },
      { a: 'C', b: 'A', scoreA: 60, scoreB: 90 },
    ])!
    const cfg = fitToConfig(fit)
    assert.ok(Number.isFinite(cfg.parScore))
    assert.ok(cfg.pointsPerSkill > 0)
    assert.ok(cfg.varianceRating >= 0)
    assert.ok(Number.isFinite(cfg.varianceRating))
  })

  it('falls back to a usable slope when skill explains nothing', () => {
    // every game a draw: the fitted slope is zero and must not produce a
    // configuration that divides by it
    const fit = fitOutcomeModel([
      { a: 'A', b: 'B', scoreA: 75, scoreB: 75 },
      { a: 'B', b: 'C', scoreA: 75, scoreB: 75 },
      { a: 'A', b: 'C', scoreA: 75, scoreB: 75 },
      { a: 'C', b: 'A', scoreA: 75, scoreB: 75 },
    ])!
    const cfg = fitToConfig(fit)
    assert.ok(cfg.pointsPerSkill > 0)
    assert.ok(Number.isFinite(cfg.varianceRating))
  })
})
