'use client'

import { FunctionPicker } from '@/components/editor/FunctionPicker'
import { Callout, Intro } from './Field'

export function StepRanking() {
  return (
    <div className="space-y-8">
      <Intro
        title="Ranking"
        body="Turns the results table into a final order. It is called after every round, not just the last — that is what makes the convergence curve on the results page possible, and it costs you nothing to write."
      />

      <FunctionPicker kind="ranking" />

      <Callout>
        Two of the built-ins are reference points rather than strategies. <code className="font-mono">oracle</code>{' '}
        ranks by true skill and scores a perfect 1.0 by definition — the ceiling. {' '}
        <code className="font-mono">initial_seed</code> ignores every result and ranks by seeding —
        the floor, and how good you would look without holding the tournament at all. Run both;
        a tiebreak that lands closer to the floor than the ceiling is not earning its keep.
      </Callout>

      <details className="card p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Rating update
          <span className="ml-2 text-xs font-normal text-ink-muted">
            Elo, Glicko, or nothing at all
          </span>
        </summary>
        <div className="mt-4">
          <p className="mb-3 max-w-3xl text-xs leading-relaxed text-ink-muted">
            Runs after every round. Most classic tiebreaks ignore ratings entirely, in which case
            leave this at <code className="font-mono">none</code>. Switch it on when you want to
            pair on live strength estimates, or rank by a posterior instead of by match points —
            rating systems use the <em>whole</em> result graph, which one-hop tiebreaks like
            Buchholz cannot.
          </p>
          <FunctionPicker kind="rating" />
        </div>
      </details>
    </div>
  )
}
