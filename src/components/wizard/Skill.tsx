'use client'

import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { FunctionPicker } from '@/components/editor/FunctionPicker'
import { axisProps, gridProps, histogram, seriesColor, tooltipStyle } from '@/lib/chartTheme'
import { pStrongerWins, sampleSkills, skillRange, varianceFor } from '@/lib/simConfig'
import { useWizard } from '@/lib/store/wizard'
import { Callout, Intro } from './Field'
import { WorldModel } from './WorldModel'
import { NumberField, Segmented, SliderField } from './controls'

export function StepSkill() {
  const cfg = useWizard((s) => s.config)
  const patch = useWizard((s) => s.patch)
  const s = cfg.skill
  const v = cfg.variance

  const skills = useMemo(() => sampleSkills(s, Math.max(cfg.players, 400), 7), [s, cfg.players])
  const bins = useMemo(() => histogram(skills, 28), [skills])
  const [lo, hi] = useMemo(() => (skills.length ? [Math.min(...skills), Math.max(...skills)] : skillRange(s)), [skills, s])

  const deterministic = v.max_up === 0 && v.max_down === 0

  // P(stronger wins) across the gap range, for a mid-field player.
  const curve = useMemo(() => {
    const mid = (lo + hi) / 2
    const span = hi - lo
    const vMid = varianceFor(mid, lo, hi, v)
    const points = []
    for (let i = 0; i <= 40; i++) {
      const gap = (i / 40) * span * 0.5
      const weaker = mid - gap
      const vWeak = varianceFor(weaker, lo, hi, v)
      points.push({ gap, p: pStrongerWins(mid, weaker, vMid, vWeak) })
    }
    return points
  }, [lo, hi, v])

  const upsetAt = (frac: number) => {
    const target = (hi - lo) * frac * 0.5
    const nearest = curve.reduce((best, p) =>
      Math.abs(p.gap - target) < Math.abs(best.gap - target) ? p : best
    )
    return 1 - nearest.p
  }

  return (
    <div className="space-y-8">
      <Intro
        title="Skill and scoring"
        body="Every player gets one true skill number, drawn from the distribution below. Each match, that skill wobbles by a random amount — the whole point of the exercise is that the tournament only ever sees the wobbled version and has to recover the underlying order from it."
      />

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          <Segmented
            label="Distribution"
            value={s.kind}
            onChange={(kind) => patch({ skill: { ...s, kind } })}
            options={[
              { value: 'uniform', label: 'Uniform', hint: 'Flat across the range — the arXiv comparison uses 1400–2200' },
              { value: 'normal', label: 'Normal', hint: 'Most players clustered near the mean' },
              { value: 'linear', label: 'Ladder', hint: 'Evenly spaced and identical every replication' },
              { value: 'bimodal', label: 'Bimodal', hint: 'Two clumps — a strong section and a weak one' },
            ]}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            {(s.kind === 'uniform' || s.kind === 'linear' || s.kind === 'bimodal') && (
              <>
                <NumberField label="Weakest" value={s.min} step={50} onChange={(min) => patch({ skill: { ...s, min } })} />
                <NumberField label="Strongest" value={s.max} step={50} onChange={(max) => patch({ skill: { ...s, max } })} />
              </>
            )}
            {(s.kind === 'normal' || s.kind === 'bimodal') && (
              <NumberField
                label="Spread (σ)"
                value={s.stdev}
                min={0}
                step={10}
                onChange={(stdev) => patch({ skill: { ...s, stdev } })}
              />
            )}
            {s.kind === 'normal' && (
              <NumberField label="Mean" value={s.mean} step={50} onChange={(mean) => patch({ skill: { ...s, mean } })} />
            )}
          </div>

          {s.kind === 'linear' && (
            <p className="text-xs text-ink-muted">
              A ladder is the same every replication, so the only thing varying between runs is
              match luck. Useful when you want to isolate that from the luck of who showed up.
            </p>
          )}
        </div>

        <figure className="card p-3">
          <figcaption className="mb-2">
            <div className="text-xs font-medium">Skill distribution</div>
            <div className="text-[11px] text-ink-muted">
              {skills.length.toLocaleString()} sampled players, {Math.round(lo)}–{Math.round(hi)}
            </div>
          </figcaption>
          <div className="h-40">
            <ResponsiveContainer>
              <BarChart data={bins} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid {...gridProps} />
                <XAxis
                  dataKey="x"
                  {...axisProps}
                  tickFormatter={(x: number) => String(Math.round(x))}
                  interval="preserveStartEnd"
                />
                <YAxis {...axisProps} width={38} />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(val: number) => [val, 'players']}
                  labelFormatter={(x: number) => `skill ≈ ${Math.round(x)}`}
                />
                <Bar dataKey="count" fill={seriesColor(0)} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </figure>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-medium">Random component</h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              How far a player&rsquo;s skill can swing in any single match. Set both to zero and the
              stronger player wins every time — which makes a useful sanity check, because a
              tournament that still gets the order wrong under those conditions has a broken
              pairing or ranking function.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField
              label="Max gain"
              value={v.max_up}
              min={0}
              step={10}
              onChange={(max_up) => patch({ variance: { ...v, max_up } })}
            />
            <NumberField
              label="Max loss"
              value={v.max_down}
              min={0}
              step={10}
              onChange={(max_down) => patch({ variance: { ...v, max_down } })}
            />
          </div>

          <Segmented
            label="Shape"
            value={v.kind}
            onChange={(kind) => patch({ variance: { ...v, kind } })}
            options={[
              { value: 'uniform', label: 'Uniform', hint: 'Every value in range equally likely' },
              { value: 'triangular', label: 'Triangular', hint: 'Peaked at no change, tapering to the limits' },
              { value: 'normal', label: 'Normal', hint: 'Bell curve, clamped at the limits' },
            ]}
          />

          <SliderField
            label="Consistency of strong players"
            value={v.skill_coupling}
            min={0}
            max={1}
            step={0.05}
            format={(x) => `${Math.round(x * 100)}%`}
            onChange={(skill_coupling) => patch({ variance: { ...v, skill_coupling } })}
            hint={
              v.skill_coupling === 0
                ? 'Everyone is equally erratic.'
                : `The strongest player swings ${Math.round((1 - Math.pow(1 - v.skill_coupling, v.exponent)) * 100)}% less than the weakest.`
            }
          />

          <SliderField
            label="Curve"
            value={v.exponent}
            min={0.25}
            max={3}
            step={0.25}
            format={(x) => `×${x}`}
            onChange={(exponent) => patch({ variance: { ...v, exponent } })}
            hint="Above 1, consistency is concentrated at the very top of the field."
          />
        </div>

        <figure className="card p-3">
          <figcaption className="mb-2">
            <div className="text-xs font-medium">Chance the stronger player wins</div>
            <div className="text-[11px] text-ink-muted">
              versus the skill gap between them, for a mid-field player
            </div>
          </figcaption>
          <div className="h-40">
            <ResponsiveContainer>
              <LineChart data={curve} margin={{ top: 4, right: 12, bottom: 0, left: -18 }}>
                <CartesianGrid {...gridProps} />
                <XAxis
                  dataKey="gap"
                  {...axisProps}
                  tickFormatter={(x: number) => String(Math.round(x))}
                  interval="preserveStartEnd"
                />
                <YAxis {...axisProps} width={38} domain={[0.4, 1]} tickFormatter={(x: number) => x.toFixed(1)} />
                <ReferenceLine y={1} stroke="var(--axis)" strokeDasharray="3 3" />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(val: number) => [`${(val * 100).toFixed(1)}%`, 'stronger wins']}
                  labelFormatter={(x: number) => `gap ${Math.round(x)}`}
                />
                <Line
                  type="monotone"
                  dataKey="p"
                  stroke={seriesColor(0)}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-2 text-center">
            {[
              ['Close match', 0.1],
              ['Moderate gap', 0.35],
              ['Big gap', 0.7],
            ].map(([label, frac]) => (
              <div key={label as string}>
                <dt className="text-[11px] text-ink-muted">{label}</dt>
                <dd className="num text-sm">
                  {deterministic ? '0%' : `${(upsetAt(frac as number) * 100).toFixed(1)}%`}
                </dd>
                <dd className="text-[10px] text-ink-muted">upset rate</dd>
              </div>
            ))}
          </dl>
        </figure>
      </section>

      {deterministic && (
        <Callout>
          Variance is zero, so results are fully determined by skill. Any ranking error you
          see from here is the tournament&rsquo;s fault, not the dice&rsquo;s — this is the
          configuration to run first when a pairing function is misbehaving.
        </Callout>
      )}

      <WorldModel />

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Match outcome</h3>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-muted">
            Takes the two wobbled skills and returns the points each side earns. Those two numbers
            are the currency of everything downstream: they become each player&rsquo;s score, they
            decide which score group the pairing function puts them in, and every tiebreak reads
            them. Switching from 1/0 to 3/1/0 changes the shape of the whole tournament.
          </p>
        </div>
        <FunctionPicker kind="outcome" />
      </section>

      <section className="space-y-3">
        <details className="card p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Seeding ratings
            <span className="ml-2 text-xs font-normal text-ink-muted">
              how well the field is known before round 1
            </span>
          </summary>
          <div className="mt-3 space-y-3">
            <Segmented
              value={cfg.initial_rating.mode}
              onChange={(mode) => patch({ initial_rating: { ...cfg.initial_rating, mode } })}
              options={[
                { value: 'true', label: 'Perfect', hint: 'Seeding rating equals true skill' },
                { value: 'noisy', label: 'Imperfect', hint: 'Seeding rating is true skill plus error — the realistic case' },
                { value: 'flat', label: 'Unrated', hint: 'Everyone starts at the same rating' },
              ]}
            />
            {cfg.initial_rating.mode === 'noisy' && (
              <NumberField
                label="Rating error (σ)"
                value={cfg.initial_rating.noise}
                min={0}
                step={10}
                onChange={(noise) => patch({ initial_rating: { ...cfg.initial_rating, noise } })}
                hint="A real published rating is typically 50–150 points off a player's current strength."
              />
            )}
            {cfg.initial_rating.mode === 'flat' && (
              <NumberField
                label="Starting rating"
                value={cfg.initial_rating.value}
                step={50}
                onChange={(value) => patch({ initial_rating: { ...cfg.initial_rating, value } })}
              />
            )}
            {cfg.initial_rating.mode === 'true' ? (
              <p className="rounded-md border border-warn/40 bg-warn/5 p-2 text-xs leading-relaxed text-warn">
                Perfect seeding leaks the answer. Seed order becomes exactly true-skill order, and
                every ranking function tiebreaks on seed — so the standings score near 1.0 after
                round one and then <em>get worse</em> as real results arrive. Use it to model
                &ldquo;ratings are perfect&rdquo;, but do not read the accuracy numbers as a verdict
                on the pairing.
              </p>
            ) : (
              <p className="text-xs leading-relaxed text-ink-muted">
                Imperfect seeding is the honest test: the rating points the tournament in roughly
                the right direction without giving the game away. Unrated is the hardest — the
                ranking has to be built from results alone.
              </p>
            )}
          </div>
        </details>
      </section>
    </div>
  )
}
