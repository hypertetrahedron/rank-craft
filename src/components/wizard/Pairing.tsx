'use client'

import { FunctionPicker } from '@/components/editor/FunctionPicker'
import { Callout, Intro } from './Field'

export function StepPairing() {
  return (
    <div className="space-y-8">
      <Intro
        title="Pairing"
        body="Called once per round to decide who plays whom. This is the lever the Swiss system actually pulls: pair equals against equals and the standings sharpen fast, pair badly and seven rounds tell you less than three would have."
      />

      <FunctionPicker kind="pairing" />

      <Callout>
        In the arXiv&nbsp;2112.10522 comparison, ranking quality ran{' '}
        <strong>Burstein &gt; Random2 &gt; Dutch &gt; Random &gt; Monrad</strong>. Random2 — pairing
        at random <em>within</em> score groups — beating carefully engineered Dutch is the
        surprising part, and it is worth reproducing here before trusting anything else the tool
        tells you.
      </Callout>

      <details className="card p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Seeding order
          <span className="ml-2 text-xs font-normal text-ink-muted">
            the table round 1 pairs from
          </span>
        </summary>
        <div className="mt-4">
          <p className="mb-3 max-w-3xl text-xs leading-relaxed text-ink-muted">
            Runs once, before the tournament starts. Its output becomes{' '}
            <code className="font-mono">Player.seed</code>, which round-1 pairings read and which
            breaks ties in the standings all tournament. Splitting it out from the pairing function
            is what makes accelerated-pairing experiments clean.
          </p>
          <FunctionPicker kind="seeding" />
        </div>
      </details>
    </div>
  )
}
