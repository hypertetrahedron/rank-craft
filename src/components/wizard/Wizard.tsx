'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { Boundary } from '@/components/Boundary'
import { MigrationBanner } from '@/components/MigrationBanner'
import { DEFAULT_BUILTIN, loadBuiltins, parseParams } from '@/lib/builtins'
import { FUNCTION_KINDS } from '@/lib/simConfig'
import { useWizard } from '@/lib/store/wizard'
import { ConfigBar } from './ConfigBar'
import { StepField } from './Field'
import { StepNav, Stepper } from './Stepper'

/**
 * Steps beyond the first load on demand. Step 1 is a handful of number fields,
 * but the later ones drag in CodeMirror and Recharts — statically importing
 * them put both in the initial bundle for a page that opens on a form.
 */
const loading = () => <p className="text-sm text-ink-muted">Loading…</p>
const StepSkill = dynamic(() => import('./Skill').then((m) => m.StepSkill), { loading })
const StepPairing = dynamic(() => import('./Pairing').then((m) => m.StepPairing), { loading })
const StepRanking = dynamic(() => import('./Ranking').then((m) => m.StepRanking), { loading })
const StepRun = dynamic(() => import('./Run').then((m) => m.StepRun), { loading })
const StepResults = dynamic(() => import('./Results').then((m) => m.StepResults), { loading })

export function Wizard() {
  const step = useWizard((s) => s.step)
  const [hydrated, setHydrated] = useState(false)

  // Function code lives in the built-ins files, which are fetched at runtime.
  // Fill in any hook still holding its placeholder — including after a persisted
  // config is rehydrated from a previous session.
  useEffect(() => {
    let cancelled = false
    loadBuiltins().then((all) => {
      if (cancelled) return
      const { config, setFunction } = useWizard.getState()
      for (const kind of FUNCTION_KINDS) {
        if (!config.functions[kind].code.startsWith('# loading')) continue
        const pick =
          all[kind].find((b) => b.name === DEFAULT_BUILTIN[kind]) ?? all[kind][0]
        if (!pick) continue
        setFunction(kind, {
          name: pick.name,
          sourceId: pick.id,
          code: pick.code,
          params: Object.fromEntries(
            Object.entries(parseParams(pick.code)).map(([k, v]) => [k, v.default])
          ),
        })
      }
      setHydrated(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="space-y-6">
      <Stepper />
      <MigrationBanner />
      <ConfigBar />
      {hydrated ? (
        <Boundary label={`Step ${step}`} key={step}>
          {step === 1 && <StepField />}
          {step === 2 && <StepSkill />}
          {step === 3 && <StepPairing />}
          {step === 4 && <StepRanking />}
          {step === 5 && <StepRun />}
          {step === 6 && <StepResults />}
        </Boundary>
      ) : (
        <p className="text-sm text-ink-muted">Loading the function library…</p>
      )}
      <StepNav />
    </div>
  )
}
