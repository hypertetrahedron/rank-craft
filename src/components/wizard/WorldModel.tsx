'use client'

import { useWizard } from '@/lib/store/wizard'
import { NumberField, Segmented, SliderField } from './controls'

/**
 * The three ways a game can depart from "the stronger player usually wins":
 * matchups that beat each other in a circle, going first, and tiring. Each is
 * off by default, and switching one off leaves the random stream untouched, so
 * an existing seed keeps producing exactly the field it always did.
 */
export function WorldModel() {
  const cfg = useWizard((s) => s.config)
  const patch = useWizard((s) => s.patch)
  const m = cfg.matchup
  const side = cfg.side
  const fatigue = cfg.fatigue

  const [lo, hi] =
    cfg.skill.kind === 'normal'
      ? [cfg.skill.mean - 2 * cfg.skill.stdev, cfg.skill.mean + 2 * cfg.skill.stdev]
      : [cfg.skill.min, cfg.skill.max]
  const span = Math.max(1, hi - lo)
  const asFieldFraction = (v: number) => `${((v / span) * 100).toFixed(0)}% of the field's range`

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">How else a game can be decided</h3>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-muted">
          Everything so far assumes players sit on a single line and the higher one usually wins.
          These three break that assumption in the ways real games do. All are off by default.
        </p>
      </div>

      <details className="card p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Matchups
          <span className="ml-2 text-xs font-normal text-ink-muted">
            {m.kind === 'none' || m.amplitude === 0
              ? 'off — skill is the only thing that decides a game'
              : `${m.archetypes} archetypes, ±${m.amplitude} skill`}
          </span>
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs leading-relaxed text-ink-muted">
            Armies, decks and playstyles beat each other in a circle. With three archetypes it is
            literally rock-paper-scissors: each beats one and loses to another whatever the skill
            gap. This is the single assumption every rating system rests on, and the only setting
            here that can break it.
          </p>
          <Segmented
            value={m.kind}
            onChange={(kind) => patch({ matchup: { ...m, kind } })}
            options={[
              { value: 'none', label: 'Off', hint: 'Skill alone decides' },
              { value: 'circular', label: 'Circular', hint: 'Archetypes on a circle; the bonus is antisymmetric' },
            ]}
          />
          {m.kind === 'circular' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField
                label="Archetypes"
                value={m.archetypes}
                min={2}
                max={12}
                onChange={(archetypes) => patch({ matchup: { ...m, archetypes } })}
                hint="3 is rock-paper-scissors; more makes the circle gentler"
              />
              <NumberField
                label="Matchup swing"
                value={m.amplitude}
                min={0}
                step={20}
                onChange={(amplitude) => patch({ matchup: { ...m, amplitude } })}
                hint={
                  m.amplitude === 0
                    ? 'Zero means archetypes exist but do not matter'
                    : `${asFieldFraction(m.amplitude)} — a bad matchup costs this much skill`
                }
              />
            </div>
          )}
          {m.kind === 'circular' && m.amplitude > 0 && (
            <p className="text-xs leading-relaxed text-warn">
              With matchups on, part of every result is who you were drawn against rather than how
              good you are. <code className="font-mono">matchup_adjusted</code> in step 4 fits the
              archetype effect and the skill jointly, which is the only ranking here that can tell
              them apart.
            </p>
          )}
        </div>
      </details>

      <details className="card p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Going first
          <span className="ml-2 text-xs font-normal text-ink-muted">
            {side.mode === 'none' || side.advantage === 0
              ? 'off — no side advantage'
              : `${side.mode}, worth ${side.advantage} skill`}
          </span>
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs leading-relaxed text-ink-muted">
            In 40k the first turn is worth real points, and it is decided at the table rather than
            by the pairing. Switching this on also makes the colour-balance diagnostics meaningful
            — with no sides they report nothing rather than a misleading zero.
          </p>
          <Segmented
            value={side.mode}
            onChange={(mode) => patch({ side: { ...side, mode } })}
            options={[
              { value: 'none', label: 'Off', hint: 'No side advantage' },
              { value: 'random', label: 'Rolled off', hint: 'A coin flip at the table — how 40k does it' },
              { value: 'pairing', label: 'Set by pairing', hint: 'The pairing function decides, as in chess colours' },
            ]}
          />
          {side.mode !== 'none' && (
            <NumberField
              label="Worth (skill)"
              value={side.advantage}
              min={0}
              step={10}
              onChange={(advantage) => patch({ side: { ...side, advantage } })}
              hint={side.advantage > 0 ? asFieldFraction(side.advantage) : 'Zero means the side does not matter'}
            />
          )}
        </div>
      </details>

      <details className="card p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Fatigue
          <span className="ml-2 text-xs font-normal text-ink-muted">
            {fatigue.amplitude === 0 ? 'off — nobody tires' : `up to ${fatigue.amplitude} skill per round`}
          </span>
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs leading-relaxed text-ink-muted">
            Six games in a weekend is a long day. Only uneven fatigue changes a ranking — if
            everyone tires equally it cancels out — so this needs a spread to do anything.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField
              label="Skill lost per round"
              value={fatigue.amplitude}
              min={0}
              step={10}
              onChange={(amplitude) => patch({ fatigue: { ...fatigue, amplitude } })}
              hint="For a player with no stamina at all"
            />
            <SliderField
              label="Spread across the field"
              value={fatigue.spread}
              min={0}
              max={1}
              step={0.05}
              format={(x) => `${Math.round(x * 100)}%`}
              onChange={(spread) => patch({ fatigue: { ...fatigue, spread } })}
              hint={
                fatigue.spread === 0
                  ? 'Everyone tires identically, which cancels out of the ranking.'
                  : 'Some players fade and some do not — this is what makes late rounds noisier.'
              }
            />
          </div>
        </div>
      </details>
    </section>
  )
}
