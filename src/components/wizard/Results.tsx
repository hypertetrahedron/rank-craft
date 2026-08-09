'use client'

import Link from 'next/link'
import { Boundary } from '@/components/Boundary'
import { ConvergenceChart } from '@/components/results/ConvergenceChart'
import { Diagnostics } from '@/components/results/Diagnostics'
import { DisplacementHistogram } from '@/components/results/DisplacementHistogram'
import { MetricCards, MetricTable } from '@/components/results/MetricCards'
import { SkillRankScatter } from '@/components/results/SkillRankScatter'
import { TournamentInspector } from '@/components/results/TournamentInspector'
import { exportCsv, exportJson } from '@/lib/exportRun'
import { summarise } from '@/lib/stats'
import { useHydratedRuns, useWizard } from '@/lib/store/wizard'
import { Intro } from './Field'

export function StepResults() {
  const { runs, hydrated } = useHydratedRuns()
  const activeId = useWizard((s) => s.activeRunId)
  const setActiveRun = useWizard((s) => s.setActiveRun)
  const setStep = useWizard((s) => s.setStep)

  const run = runs.find((r) => r.id === activeId) ?? runs[runs.length - 1]

  if (!hydrated) {
    return <p className="text-sm text-ink-muted">Loading previous runs…</p>
  }

  if (!run) {
    return (
      <div className="space-y-4">
        <Intro title="Results" body="Nothing has been run yet." />
        <button className="btn btn-primary" onClick={() => setStep(5)}>
          Go to the run step
        </button>
      </div>
    )
  }

  const { result, config } = run
  const tau = summarise(result.final.kendall_tau ?? [])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{run.label}</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {config.players} players, {config.rounds} rounds,{' '}
            {result.replication_ids.length.toLocaleString()} replications, seed {config.seed}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {runs.length > 1 && (
            <select
              className="input w-auto"
              value={run.id}
              onChange={(e) => setActiveRun(e.target.value)}
            >
              {[...runs].reverse().map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          )}
          <button className="btn" onClick={() => exportCsv(run)}>
            CSV
          </button>
          <button className="btn" onClick={() => exportJson(run)}>
            JSON
          </button>
          {runs.length > 1 && (
            <Link href="/compare" className="btn btn-primary">
              Compare {runs.length} runs
            </Link>
          )}
        </div>
      </div>

      {tau && (
        <p className="max-w-3xl text-sm leading-relaxed text-ink-muted">
          Over {result.replication_ids.length.toLocaleString()} tournaments, this configuration
          recovered the true skill order with a Kendall τ of{' '}
          <span className="font-medium text-ink">{tau.mean.toFixed(4)}</span> — meaning{' '}
          {((1 - tau.mean) * 50).toFixed(1)}% of all player pairs finished in the wrong order.{' '}
          {runs.length < 2 && (
            <>
              That number is only meaningful next to another one: run{' '}
              <code className="font-mono">oracle</code> and{' '}
              <code className="font-mono">initial_seed</code> on the same seed to bracket it.
            </>
          )}
        </p>
      )}

      {/* Each panel is contained: these render charts over whatever shape the
          user's own Python produced, and one degenerate metric should not take
          the whole results page with it. */}
      <Boundary label="The summary">
        <MetricCards result={result} />
      </Boundary>
      <Boundary label="The convergence chart">
        <ConvergenceChart result={result} />
      </Boundary>

      <div className="grid gap-6 xl:grid-cols-2">
        {result.sample && (
          <Boundary label="The skill-versus-finish chart">
            <SkillRankScatter sample={result.sample} />
          </Boundary>
        )}
        <Boundary label="The reliability histogram">
          <DisplacementHistogram result={result} />
        </Boundary>
      </div>

      <Boundary label="The metric table">
        <MetricTable result={result} />
      </Boundary>
      <Boundary label="The health table">
        <Diagnostics result={result} />
      </Boundary>
      {result.sample && (
        <Boundary label="The tournament inspector">
          <TournamentInspector sample={result.sample} />
        </Boundary>
      )}
    </div>
  )
}
