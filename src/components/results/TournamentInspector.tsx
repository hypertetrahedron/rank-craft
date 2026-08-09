'use client'

import { useState } from 'react'
import type { SampleTournament } from '@/lib/pyodide/protocol'

/** Round-by-round view of one representative tournament. The escape hatch when
 *  a metric looks wrong and you need to see what actually happened. */
export function TournamentInspector({ sample }: { sample: SampleTournament }) {
  const [round, setRound] = useState(sample.log.length)
  const current = sample.log[round - 1]
  const byId = new Map(sample.field.map((p) => [p.id, p]))
  const trueRank = new Map(sample.truth.map((id, i) => [id, i + 1]))

  if (!current) return null

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-medium">Inspect one tournament</h3>
          <p className="mt-0.5 text-xs text-ink-muted">
            The first replication, round by round. Effective skill is what the outcome function
            actually saw, after that match&rsquo;s noise.
          </p>
        </div>
        <div className="flex gap-1">
          {sample.log.map((r) => (
            <button
              key={r.round}
              onClick={() => setRound(r.round)}
              className={`num rounded-md border px-2 py-1 text-xs ${
                round === r.round
                  ? 'border-accent bg-accent text-accent-ink'
                  : 'border-border hover:bg-surface'
              }`}
            >
              {r.round}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-0 md:grid-cols-2">
        <div className="overflow-x-auto border-b border-border md:border-b-0 md:border-r">
          <div className="label px-4 pt-3">Pairings</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-ink-muted">
                <th className="px-4 py-1.5 font-medium">White</th>
                <th className="px-4 py-1.5 font-medium">Black</th>
                <th className="px-4 py-1.5 font-medium">Effective skill</th>
                <th className="px-4 py-1.5 font-medium">Points</th>
              </tr>
            </thead>
            <tbody className="num">
              {current.matches.map((m, i) => {
                const upset =
                  m.b !== null &&
                  m.skill_a !== null &&
                  m.skill_b !== null &&
                  ((byId.get(m.a)!.skill > byId.get(m.b)!.skill && m.points_a < m.points_b) ||
                    (byId.get(m.b)!.skill > byId.get(m.a)!.skill && m.points_b < m.points_a))
                return (
                  <tr key={i} className="border-t border-border">
                    <td className="px-4 py-1.5">{byId.get(m.a)?.name}</td>
                    <td className="px-4 py-1.5">
                      {m.b === null ? <span className="text-ink-muted">bye</span> : byId.get(m.b)?.name}
                    </td>
                    <td className="px-4 py-1.5 text-ink-muted">
                      {m.skill_a?.toFixed(0) ?? '—'}
                      {m.b !== null && ` v ${m.skill_b?.toFixed(0) ?? '—'}`}
                    </td>
                    <td className="px-4 py-1.5">
                      {m.points_a}
                      {m.b !== null && `–${m.points_b}`}
                      {upset && <span className="ml-1.5 text-warn" title="the weaker player won">upset</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="overflow-x-auto">
          <div className="label px-4 pt-3">Standings after round {round}</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-ink-muted">
                <th className="px-4 py-1.5 font-medium">#</th>
                <th className="px-4 py-1.5 font-medium">Player</th>
                <th className="px-4 py-1.5 font-medium">True rank</th>
                <th className="px-4 py-1.5 font-medium">Off by</th>
              </tr>
            </thead>
            <tbody className="num">
              {current.ranking.map((id, i) => {
                const t = trueRank.get(id) ?? 0
                const err = Math.abs(t - (i + 1))
                return (
                  <tr key={id} className="border-t border-border">
                    <td className="px-4 py-1.5">{i + 1}</td>
                    <td className="px-4 py-1.5">{byId.get(id)?.name}</td>
                    <td className="px-4 py-1.5 text-ink-muted">{t}</td>
                    <td className={`px-4 py-1.5 ${err > 3 ? 'text-warn' : 'text-ink-muted'}`}>
                      {err === 0 ? '·' : err}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
