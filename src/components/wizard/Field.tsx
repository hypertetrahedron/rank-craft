'use client'

import { NumberField, Segmented } from './controls'
import { matchCount, recommendedRounds } from '@/lib/simConfig'
import { useWizard } from '@/lib/store/wizard'

export function StepField() {
  const cfg = useWizard((s) => s.config)
  const patch = useWizard((s) => s.patch)
  const suggested = recommendedRounds(cfg.players)
  const matches = matchCount(cfg)

  // A round-robin is the most a field can play without anyone meeting twice.
  // Past that no legal Swiss pairing exists and every system is forced into
  // rematches, which quietly changes what the fairness numbers mean.
  const maxLegalRounds = cfg.players - 1
  const roundsTooMany = cfg.rounds > maxLegalRounds
  const roundsTight = !roundsTooMany && cfg.rounds > maxLegalRounds * 0.6

  return (
    <div className="space-y-6">
      <Intro
        title="The field"
        body="How many players, how many rounds, and how many times to repeat the whole tournament. Replications are what turn a single noisy result into a number with an error bar — one tournament tells you almost nothing."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <NumberField
          label="Players"
          value={cfg.players}
          min={2}
          max={512}
          step={1}
          onChange={(players) => patch({ players })}
          hint={cfg.players % 2 === 1 ? 'Odd field — one bye per round' : undefined}
        />
        <NumberField
          label="Rounds"
          value={cfg.rounds}
          min={1}
          max={30}
          step={1}
          onChange={(rounds) => patch({ rounds })}
          hint={
            roundsTooMany
              ? `More than ${maxLegalRounds} rounds is impossible without rematches — ${cfg.players} players can only meet each other once.`
              : roundsTight
                ? `Close to the ${maxLegalRounds}-round limit for ${cfg.players} players; expect forced rematches.`
                : cfg.rounds === suggested
                  ? `${suggested} is the usual choice for ${cfg.players}`
                  : `⌈log₂(${cfg.players})⌉ = ${suggested} is the usual choice`
          }
          tone={roundsTooMany ? 'bad' : roundsTight ? 'warn' : undefined}
          action={
            cfg.rounds !== suggested
              ? { label: `Use ${suggested}`, onClick: () => patch({ rounds: suggested }) }
              : undefined
          }
        />
        <NumberField
          label="Replications"
          value={cfg.replications}
          min={1}
          max={20000}
          step={50}
          onChange={(replications) => patch({ replications })}
          hint="200–500 is plenty when comparing under a shared seed"
        />
        <NumberField
          label="Seed"
          value={cfg.seed}
          min={0}
          max={2 ** 31 - 1}
          step={1}
          onChange={(seed) => patch({ seed })}
          hint="Same seed ⇒ same field and same match luck"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          label="Points for a bye"
          value={cfg.bye_points}
          min={0}
          max={10}
          step={0.5}
          onChange={(bye_points) => patch({ bye_points })}
          hint="1.0 is a full win, the FIDE default"
        />
        <div className="card p-3">
          <div className="label">Work</div>
          <p className="mt-1 text-2xl">{matches.toLocaleString()}</p>
          <p className="mt-1 text-xs text-ink-muted">
            simulated matches
            {matches > 20_000_000 && (
              <span className="text-warn">
                {' '}
                — this will take a while. Drop the replications to sketch first.
              </span>
            )}
          </p>
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="card p-3">
          <Segmented
            label="Swiss brackets are made of"
            value={cfg.bracket_by}
            onChange={(bracket_by) => patch({ bracket_by })}
            options={[
              { value: 'score', label: 'Points', hint: 'Chess: everyone on 4.5 is one bracket' },
              { value: 'wins', label: 'Win record', hint: 'Needed when a game scores 0-100 a side' },
            ]}
          />
          <p className="mt-2 text-[11px] leading-snug text-ink-muted">
            {cfg.bracket_by === 'score'
              ? 'Buckets by accumulated points. Correct for chess-like scoring, and useless for a game where every player’s total is unique.'
              : 'Buckets by match record, so a 4–1 plays a 4–1 however many points they scored.'}
          </p>
        </div>
        <NumberField
          label="Top cut"
          value={cfg.top_cut}
          min={0}
          max={64}
          step={2}
          onChange={(top_cut) => patch({ top_cut })}
          hint={
            cfg.top_cut === 0
              ? 'No bracket — the Swiss standings are the result.'
              : `Top ${cfg.top_cut} play a seeded single-elimination bracket. Asks whether the right player wins, not just whether the standings are ordered.`
          }
        />
      </section>

      <Callout>
        The seed is the whole reason comparison works here. Two strategies run on the same
        seed face an identical field <em>and</em> identical match luck, replication by
        replication — so the difference between them is a paired measurement, and a few hundred
        replications separate strategies that would need thousands of independent runs.
      </Callout>
    </div>
  )
}

export function Intro({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-muted">{body}</p>
    </div>
  )
}

export function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border-l-2 border-accent bg-surface-2 px-3 py-2 text-xs leading-relaxed text-ink-muted">
      {children}
    </div>
  )
}
