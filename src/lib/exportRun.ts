'use client'

import { FAIRNESS_METRICS, FINAL_METRICS, ROUND_METRICS } from './pyodide/protocol'
import type { RunRecord } from './store/wizard'
import { summarise, summariseByRound } from './stats'

function download(name: string, mime: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/**
 * Per-replication rows, not summaries. Aggregates are one groupby away in any
 * tool, but a summary cannot be un-averaged — and the paired analysis that makes
 * this app worth using needs the individual replications.
 */
export function exportCsv(run: RunRecord) {
  const { result } = run
  const cols = [...FINAL_METRICS, ...FAIRNESS_METRICS]
  const rounds = result.per_round.tau_vs_true?.[0]?.length ?? 0
  const roundCols = ROUND_METRICS.flatMap((m) =>
    Array.from({ length: rounds }, (_, r) => `${m}_r${r + 1}`)
  )

  const header = ['replication', ...cols, ...roundCols].join(',')
  const rows = result.replication_ids.map((rep, i) => {
    const vals = cols.map((c) => {
      const src = (FINAL_METRICS as readonly string[]).includes(c)
        ? result.final[c as (typeof FINAL_METRICS)[number]]
        : result.fairness[c as (typeof FAIRNESS_METRICS)[number]]
      return src?.[i] ?? ''
    })
    const roundVals = ROUND_METRICS.flatMap((m) =>
      Array.from({ length: rounds }, (_, r) => result.per_round[m]?.[i]?.[r] ?? '')
    )
    return [rep, ...vals, ...roundVals].join(',')
  })

  download(`rankcraft-${slug(run.label)}.csv`, 'text/csv', [header, ...rows].join('\n'))
}

/** Config plus summaries plus the raw arrays — enough to reproduce or re-analyse. */
export function exportJson(run: RunRecord) {
  const { result, config } = run
  const payload = {
    label: run.label,
    exportedAt: new Date(run.finishedAt).toISOString(),
    config,
    summary: {
      final: Object.fromEntries(FINAL_METRICS.map((m) => [m, summarise(result.final[m] ?? [])])),
      fairness: Object.fromEntries(
        FAIRNESS_METRICS.map((m) => [m, summarise(result.fairness[m] ?? [])])
      ),
      perRound: Object.fromEntries(
        ROUND_METRICS.map((m) => [m, summariseByRound(result.per_round[m] ?? [])])
      ),
    },
    raw: {
      replication_ids: result.replication_ids,
      final: result.final,
      fairness: result.fairness,
      per_round: result.per_round,
    },
    sample: result.sample,
  }
  download(`rankcraft-${slug(run.label)}.json`, 'application/json', JSON.stringify(payload, null, 2))
}
