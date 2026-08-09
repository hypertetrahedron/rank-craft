'use client'

import { STEPS, useWizard } from '@/lib/store/wizard'

export function Stepper() {
  const step = useWizard((s) => s.step)
  const setStep = useWizard((s) => s.setStep)

  return (
    <nav className="flex flex-wrap gap-1 border-b border-border pb-3" aria-label="Simulation steps">
      {STEPS.map((s) => {
        const active = s.id === step
        return (
          <button
            key={s.id}
            onClick={() => setStep(s.id)}
            aria-current={active ? 'step' : undefined}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
              active ? 'bg-accent text-accent-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink'
            }`}
          >
            <span
              className={`num flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                active ? 'bg-accent-ink/20' : 'bg-surface-2'
              }`}
            >
              {s.id}
            </span>
            {s.title}
          </button>
        )
      })}
    </nav>
  )
}

export function StepNav() {
  const step = useWizard((s) => s.step)
  const setStep = useWizard((s) => s.setStep)

  return (
    <div className="flex items-center justify-between border-t border-border pt-4">
      <button className="btn" onClick={() => setStep(step - 1)} disabled={step === 1}>
        ← {STEPS[step - 2]?.title ?? ''}
      </button>
      <button
        className="btn btn-primary"
        onClick={() => setStep(step + 1)}
        disabled={step === STEPS.length}
      >
        {STEPS[step]?.title ?? ''} →
      </button>
    </div>
  )
}
