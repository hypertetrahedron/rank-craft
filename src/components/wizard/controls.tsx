'use client'

export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  hint,
  tone,
  action,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (v: number) => void
  hint?: string
  /** Escalates the hint from advice to a warning about an unusable setting. */
  tone?: 'warn' | 'bad'
  action?: { label: string; onClick: () => void }
}) {
  // A stable hook for the end-to-end tests. Selecting these by their visible
  // text is ambiguous — "Seed" also matches "Seeding ratings" — and brittle the
  // moment a label is reworded.
  const field = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  return (
    <div className="card p-3" data-field={field}>
      <div className="flex items-baseline justify-between gap-2">
        <label className="label">{label}</label>
        {action && (
          <button className="text-[11px] text-accent hover:underline" onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
      <input
        type="number"
        className="input num mt-1"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(clamp(v, min, max))
        }}
      />
      {hint && (
        <p
          className={`mt-1 text-[11px] leading-snug ${
            tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-ink-muted'
          }`}
        >
          {hint}
        </p>
      )}
    </div>
  )
}

export function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  hint,
  format = (v: number) => String(v),
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  hint?: string
  format?: (v: number) => string
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="label">{label}</label>
        <span className="num text-xs">{format(value)}</span>
      </div>
      <input
        type="range"
        className="mt-1 w-full accent-current text-accent"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">{hint}</p>}
    </div>
  )
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string
  value: T
  options: { value: T; label: string; hint?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div>
      {label && <div className="label mb-1">{label}</div>}
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.value}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
              value === o.value
                ? 'border-accent bg-accent text-accent-ink'
                : 'border-border hover:bg-surface'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function clamp(v: number, min?: number, max?: number) {
  if (min !== undefined && v < min) return min
  if (max !== undefined && v > max) return max
  return v
}
