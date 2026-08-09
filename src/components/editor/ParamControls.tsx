'use client'

import type { ParamSpec } from '@/lib/builtins'

/** Renders the knobs a function declared in its PARAMS dict. */
export function ParamControls({
  specs,
  values,
  onChange,
}: {
  specs: Record<string, ParamSpec>
  values: Record<string, number | string | boolean>
  onChange: (v: Record<string, number | string | boolean>) => void
}) {
  const names = Object.keys(specs)
  if (!names.length) return null

  return (
    <div className="space-y-2 rounded-md border border-border bg-surface p-3">
      <div className="label">Parameters</div>
      {names.map((name) => {
        const spec = specs[name]
        const value = values[name] ?? spec.default
        if (typeof spec.default === 'boolean') {
          return (
            <label key={name} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={(e) => onChange({ ...values, [name]: e.target.checked })}
              />
              <span className="font-mono">{name}</span>
            </label>
          )
        }
        return (
          <div key={name} className="flex items-center gap-3">
            <span className="w-36 shrink-0 font-mono text-xs">{name}</span>
            {typeof spec.min === 'number' && typeof spec.max === 'number' ? (
              <input
                type="range"
                className="flex-1 accent-current text-accent"
                min={spec.min}
                max={spec.max}
                step={spec.step ?? 1}
                value={Number(value)}
                onChange={(e) => onChange({ ...values, [name]: Number(e.target.value) })}
              />
            ) : null}
            <input
              type="number"
              className="input w-28 num"
              step={spec.step ?? 1}
              value={Number(value)}
              onChange={(e) => onChange({ ...values, [name]: Number(e.target.value) })}
            />
          </div>
        )
      })}
    </div>
  )
}
