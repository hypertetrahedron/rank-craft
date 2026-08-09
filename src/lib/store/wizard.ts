'use client'

import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { BatchResult } from '../pyodide/protocol'
import { cacheRun, cachedRuns, uncacheRun } from './runCache'
import { defaultConfig } from '../simConfig'
import type { FunctionKind, FunctionRef, SimConfig } from '../simConfig'

export { defaultConfig }

export const STEPS = [
  { id: 1, slug: 'field', title: 'Field' },
  { id: 2, slug: 'skill', title: 'Skill' },
  { id: 3, slug: 'pairing', title: 'Pairing' },
  { id: 4, slug: 'ranking', title: 'Ranking' },
  { id: 5, slug: 'run', title: 'Run' },
  { id: 6, slug: 'results', title: 'Results' },
] as const

export type RunRecord = {
  id: string
  label: string
  config: SimConfig
  result: BatchResult
  finishedAt: number
}

type WizardState = {
  config: SimConfig
  step: number
  /** Completed runs this session, newest last. Compare mode reads from here. */
  runs: RunRecord[]
  activeRunId: string | null

  runsHydrated: boolean

  setStep: (n: number) => void
  patch: (p: Partial<SimConfig>) => void
  setFunction: (kind: FunctionKind, ref: Partial<FunctionRef>) => void
  reset: () => void
  addRun: (run: RunRecord) => void
  removeRun: (id: string) => void
  setActiveRun: (id: string | null) => void
  hydrateRuns: () => Promise<void>
}

export const useWizard = create<WizardState>()(
  persist(
    (set) => ({
      config: defaultConfig(),
      step: 1,
      runs: [],
      activeRunId: null,
      runsHydrated: false,

      setStep: (n) => set({ step: Math.max(1, Math.min(STEPS.length, n)) }),
      patch: (p) => set((s) => ({ config: { ...s.config, ...p } })),
      setFunction: (kind, ref) =>
        set((s) => ({
          config: {
            ...s.config,
            functions: { ...s.config.functions, [kind]: { ...s.config.functions[kind], ...ref } },
          },
        })),
      reset: () => set({ config: defaultConfig(), step: 1 }),
      addRun: (run) => {
        set((s) => ({ runs: [...s.runs, run].slice(-8), activeRunId: run.id }))
        void cacheRun(run)
      },
      removeRun: (id) => {
        set((s) => ({
          runs: s.runs.filter((r) => r.id !== id),
          activeRunId: s.activeRunId === id ? null : s.activeRunId,
        }))
        void uncacheRun(id)
      },
      setActiveRun: (id) => set({ activeRunId: id }),

      hydrateRuns: async () => {
        if (useWizard.getState().runsHydrated) return
        const stored = await cachedRuns()
        set((s) => {
          const known = new Set(s.runs.map((r) => r.id))
          const merged = [...stored.filter((r) => !known.has(r.id)), ...s.runs].slice(-8)
          return {
            runs: merged,
            runsHydrated: true,
            activeRunId: s.activeRunId ?? merged[merged.length - 1]?.id ?? null,
          }
        })
      },
    }),
    {
      name: 'rankcraft-wizard',
      version: 1,
      // Run results are hundreds of KB of raw per-replication arrays — far too
      // large for localStorage. They go to IndexedDB via runCache instead; this
      // store persists only the config and the current step.
      partialize: (s) => ({ config: s.config, step: s.step }),
    }
  )
)

/** Pull previously completed runs back out of IndexedDB. Safe to call anywhere. */
export function useHydratedRuns() {
  const runs = useWizard((s) => s.runs)
  const hydrated = useWizard((s) => s.runsHydrated)
  useEffect(() => {
    void useWizard.getState().hydrateRuns()
  }, [])
  return { runs, hydrated }
}

export const useConfig = () => useWizard((s) => s.config)
export const useActiveRun = () =>
  useWizard((s) => s.runs.find((r) => r.id === s.activeRunId) ?? s.runs[s.runs.length - 1] ?? null)
