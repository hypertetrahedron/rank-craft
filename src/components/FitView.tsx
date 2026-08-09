'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { fitOutcomeModel, fitToConfig, parseResultsCsv } from '@/lib/fitOutcome'
import { useWizard } from '@/lib/store/wizard'

const SAMPLE = `player_a,player_b,score_a,score_b,round
Ada,Bram,84,71,1
Cato,Dara,62,90,1
Eve,Finn,77,77,1
Ada,Cato,88,64,2
Dara,Eve,81,73,2
Bram,Finn,69,80,2
Ada,Dara,79,75,3
Eve,Bram,86,58,3
Cato,Finn,72,74,3`

/**
 * Turns a real event's result table into simulator settings.
 *
 * The largest caveat on everything this tool concludes is that the map from
 * skill to score is invented. Fitting it to an actual event replaces "this is
 * what the model implies" with "this is what your event implies", which is a
 * different class of claim.
 */
export function FitView() {
  const [text, setText] = useState('')
  const patch = useWizard((s) => s.patch)
  const config = useWizard((s) => s.config)
  const [applied, setApplied] = useState(false)

  const parsed = useMemo(() => (text.trim() ? parseResultsCsv(text) : null), [text])
  const fit = useMemo(() => (parsed?.rows.length ? fitOutcomeModel(parsed.rows) : null), [parsed])
  const settings = useMemo(() => (fit ? fitToConfig(fit) : null), [fit])

  const apply = () => {
    if (!fit || !settings) return
    const mid = 1600
    patch({
      skill: {
        ...config.skill,
        kind: 'normal',
        mean: mid,
        stdev: settings.ratingSd,
      },
      variance: {
        ...config.variance,
        kind: 'normal',
        max_up: settings.varianceRating,
        max_down: settings.varianceRating,
      },
      functions: {
        ...config.functions,
        outcome: {
          ...config.functions.outcome,
          params: {
            ...config.functions.outcome.params,
            par_score: settings.parScore,
            points_per_skill: settings.pointsPerSkill,
          },
        },
      },
    })
    setApplied(true)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-base font-semibold">Fit the model to a real event</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-muted">
          Everything RankCraft concludes rests on an assumed map from skill to score. Paste a real
          event&rsquo;s results and it will estimate that map instead — where a typical game lands,
          how much margin a point of skill buys, and how much of the result nothing in the model
          explains.
        </p>
      </div>

      <div className="card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="label">Results</div>
          <button className="btn" onClick={() => setText(SAMPLE)}>
            Use a sample
          </button>
        </div>
        <textarea
          className="input h-48 font-mono text-xs"
          spellCheck={false}
          placeholder={'player_a,player_b,score_a,score_b\nAda,Bram,84,71\n…'}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setApplied(false)
          }}
        />
        <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
          CSV or tab-separated, with a header. Column names are matched loosely, so
          <code className="mx-1 font-mono">player_a / p1 / player 1</code> all work. Nothing is
          uploaded — the fit runs in this browser.
        </p>
      </div>

      {parsed && parsed.errors.length > 0 && (
        <div className="card border-warn/40 p-4">
          <p className="text-sm font-medium text-warn">
            {parsed.rows.length ? 'Some rows were skipped' : 'Could not read that'}
          </p>
          <ul className="mt-2 space-y-1 text-xs text-ink-muted">
            {parsed.errors.slice(0, 8).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {parsed && parsed.rows.length > 0 && !fit && (
        <p className="text-sm text-ink-muted">
          Read {parsed.rows.length} games, but the fit needs at least four and a connected set of
          players.
        </p>
      )}

      {fit && settings && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Games read" value={fit.games.toLocaleString()} sub={`${fit.players} players`} />
            <Stat
              label="Typical game"
              value={fit.parScore.toFixed(1)}
              sub={`scores ran ${fit.scoreMin}–${fit.scoreMax}`}
            />
            <Stat
              label="Explained by skill"
              value={`${(fit.rSquared * 100).toFixed(0)}%`}
              sub="of the variation in margins"
              tone={fit.rSquared < 0.25 ? 'warn' : undefined}
            />
            <Stat
              label="Favourite wins"
              value={`${(fit.favouriteWinRate * 100).toFixed(0)}%`}
              sub="of decisive games, by the fitted skill"
            />
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-medium">What this implies for the simulation</h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                Applying these replaces the invented outcome model with one estimated from your
                event.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  <Row
                    name="par_score"
                    value={settings.parScore.toFixed(0)}
                    doc="Where an evenly matched game lands."
                  />
                  <Row
                    name="points_per_skill"
                    value={settings.pointsPerSkill.toFixed(4)}
                    doc="Score margin bought by one rating point of skill gap."
                  />
                  <Row
                    name="match randomness"
                    value={`±${settings.varianceRating}`}
                    doc="Skill swing per game implied by the residual the model cannot explain."
                  />
                  <Row
                    name="unexplained spread"
                    value={`${fit.noise.toFixed(1)} points`}
                    doc="Standard deviation of the margin the skill model gets wrong."
                  />
                  <Row
                    name="draws"
                    value={`${(fit.drawRate * 100).toFixed(1)}%`}
                    doc="Games that ended level. Worth matching in the outcome function."
                  />
                  <Row
                    name="games at the ceiling"
                    value={`${(fit.saturatedShare * 100).toFixed(1)}%`}
                    doc="Scores at the top or bottom of the range, where the scoreboard stops distinguishing."
                  />
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3">
              <button className="btn btn-primary" onClick={apply}>
                Apply to my setup
              </button>
              {applied && (
                <span className="text-xs text-ok">
                  Applied.{' '}
                  <Link href="/" className="underline">
                    Back to the wizard
                  </Link>{' '}
                  — check step 2, and make sure your outcome function is one that reads{' '}
                  <code className="font-mono">par_score</code>.
                </span>
              )}
            </div>
          </div>

          {fit.rSquared < 0.25 && (
            <div className="card border-warn/40 p-4 text-xs leading-relaxed text-ink-muted">
              <p className="text-sm font-medium text-warn">Skill explains very little here</p>
              <p className="mt-1">
                Under a quarter of the variation in margins is accounted for by a single skill
                number per player. That is worth knowing on its own: it means either the sample is
                too small to pin skills down, or that this game&rsquo;s scores are driven by
                something a one-dimensional model cannot see — matchups, mission, or going first.
                Try the matchup and side settings in step 2 before trusting any ranking comparison
                built on this fit.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub: string
  tone?: 'warn'
}) {
  return (
    <div className="card p-3">
      <div className="label">{label}</div>
      <p className={`num mt-1 text-2xl ${tone === 'warn' ? 'text-warn' : ''}`}>{value}</p>
      <p className="mt-1 text-[11px] leading-snug text-ink-muted">{sub}</p>
    </div>
  )
}

function Row({ name, value, doc }: { name: string; value: string; doc: string }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-2 font-mono text-xs">{name}</td>
      <td className="num px-4 py-2 text-right font-medium">{value}</td>
      <td className="px-4 py-2 text-xs text-ink-muted">{doc}</td>
    </tr>
  )
}
