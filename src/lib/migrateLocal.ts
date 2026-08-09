'use client'

import { saveFunction, type SavedFunction } from './functionStore'
import { listRuns, localConfigs, saveConfig, saveRun, type StoredConfig } from './runStore'
import { cachedRuns } from './store/runCache'
import type { RunRecord } from './store/wizard'

/**
 * Moving work made before a database existed into one that now does.
 *
 * There is no server-side data to migrate — the database starts empty. Every
 * saved function, setup and completed run lives in the browser that made it:
 * functions and setups in localStorage, runs in IndexedDB because they are far
 * too large for it. So the migration necessarily runs client-side, and it is
 * the only path by which existing work reaches the database at all.
 */

const MIGRATED_KEY = 'rankcraft-migrated'

/** Ids already uploaded, so running this twice does not duplicate anything. */
function migratedIds(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    return new Set(JSON.parse(localStorage.getItem(MIGRATED_KEY) || '[]') as string[])
  } catch {
    return new Set()
  }
}

function markMigrated(ids: string[]) {
  const all = migratedIds()
  ids.forEach((id) => all.add(id))
  localStorage.setItem(MIGRATED_KEY, JSON.stringify([...all]))
}

export type LocalInventory = {
  functions: SavedFunction[]
  configs: StoredConfig[]
  runs: RunRecord[]
  total: number
}

/** The raw local stores, before any decision about what to send. */
async function readLocal(): Promise<Omit<LocalInventory, 'total'>> {
  let functions: SavedFunction[] = []
  try {
    functions = JSON.parse(localStorage.getItem('rankcraft-functions') || '[]') as SavedFunction[]
  } catch {
    functions = []
  }
  return { functions, configs: localConfigs(), runs: await cachedRuns() }
}

/**
 * What is here that the database does not have.
 *
 * Deliberately reads the raw local stores rather than `listFunctions()`, which
 * would return the *remote* list once a database is configured and so report
 * nothing left to migrate.
 */
export async function scanLocal(): Promise<LocalInventory> {
  const local = await readLocal()
  const plan = planMigration(local, migratedIds(), new Set())
  return {
    functions: plan.functions,
    configs: plan.configs,
    runs: plan.runs,
    total: plan.functions.length + plan.configs.length + plan.runs.length,
  }
}

/** One item to upload, or a reason it is being left alone. */
export type MigrationPlan = {
  functions: SavedFunction[]
  configs: StoredConfig[]
  runs: RunRecord[]
  /** Runs already in the database, matched on label and seed. */
  duplicateRuns: RunRecord[]
}

/**
 * Decides what actually needs sending. Pure, so the rules that matter — never
 * upload the same thing twice, never duplicate a run — are testable without a
 * browser or a database.
 *
 * Functions and setups upsert by id, so re-sending one is harmless. Runs always
 * insert, so they are matched against what the database already holds; label
 * and seed together identify a run closely enough, and the cost of a false
 * match is skipping an upload rather than losing data, since the local copy is
 * kept either way.
 */
export function planMigration(
  local: Omit<LocalInventory, 'total'>,
  alreadyMigrated: Set<string>,
  remoteRunKeys: Set<string>
): MigrationPlan {
  const fresh = <T extends { id: string }>(xs: T[]) => xs.filter((x) => !alreadyMigrated.has(x.id))
  const runs = fresh(local.runs)
  const seen = new Set(remoteRunKeys)
  const toSend: RunRecord[] = []
  const duplicates: RunRecord[] = []

  for (const run of runs) {
    const key = runKey(run)
    if (seen.has(key)) {
      duplicates.push(run)
      continue
    }
    seen.add(key) // two identical local runs must not both be sent
    toSend.push(run)
  }

  return {
    functions: fresh(local.functions),
    configs: fresh(local.configs),
    runs: toSend,
    duplicateRuns: duplicates,
  }
}

export function runKey(run: { label: string; config: { seed: number } }): string {
  return `${run.label}|${run.config.seed}`
}

export type MigrationReport = {
  uploaded: number
  skipped: number
  failed: { what: string; why: string }[]
}

/**
 * Uploads everything local, skipping what is already there.
 *
 * Local copies are kept rather than deleted: they are still the offline path,
 * and destroying the only copy of a user's work to tidy up would be a poor
 * trade for the disk space involved.
 */
export async function migrateLocal(
  onProgress?: (done: number, total: number, what: string) => void
): Promise<MigrationReport> {
  const local = await readLocal()
  // Not knowing what the database already holds is a reason to send runs
  // cautiously, not a reason to abandon the whole migration.
  const remoteRuns = await listRuns().catch(() => [])
  const plan = planMigration(
    local,
    migratedIds(),
    new Set(remoteRuns.map((r) => `${r.label}|${r.seed}`))
  )

  const report: MigrationReport = { uploaded: 0, skipped: plan.duplicateRuns.length, failed: [] }
  const migrated: string[] = plan.duplicateRuns.map((r) => r.id)
  const total = plan.functions.length + plan.configs.length + plan.runs.length
  let done = 0
  const step = (what: string) => {
    done++
    onProgress?.(done, total, what)
  }

  for (const fn of plan.functions) {
    try {
      await saveFunction({
        id: fn.id,
        kind: fn.kind,
        name: fn.name,
        description: fn.description,
        code: fn.code,
        params: fn.params,
      })
      migrated.push(fn.id)
      report.uploaded++
    } catch (err) {
      report.failed.push({ what: `function "${fn.name}"`, why: (err as Error).message })
    }
    step(`function "${fn.name}"`)
  }

  for (const cfg of plan.configs) {
    try {
      await saveConfig(cfg.name, cfg.payload, cfg.id)
      migrated.push(cfg.id)
      report.uploaded++
    } catch (err) {
      report.failed.push({ what: `setup "${cfg.name}"`, why: (err as Error).message })
    }
    step(`setup "${cfg.name}"`)
  }

  for (const run of plan.runs) {
    try {
      const id = await saveRun({ label: run.label, config: run.config, result: run.result })
      if (id) {
        migrated.push(run.id)
        report.uploaded++
      } else {
        report.failed.push({ what: `run "${run.label}"`, why: 'the server did not accept it' })
      }
    } catch (err) {
      report.failed.push({ what: `run "${run.label}"`, why: (err as Error).message })
    }
    step(`run "${run.label}"`)
  }

  if (migrated.length) markMigrated(migrated)
  return report
}

/** Forget what has been uploaded, so a scan offers everything again. */
export function resetMigrationState() {
  localStorage.removeItem(MIGRATED_KEY)
}
