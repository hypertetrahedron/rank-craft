'use client'

import { useEffect, useState } from 'react'
import { HOOK_DOCS } from '@/lib/apiDocs'
import { loadBuiltins } from '@/lib/builtins'
import type { BuiltinFunction } from '@/lib/builtins'
import { deleteFunction, isLocalOnly, listFunctions } from '@/lib/functionStore'
import type { SavedFunction } from '@/lib/functionStore'
import { FUNCTION_KINDS } from '@/lib/simConfig'
import type { FunctionKind } from '@/lib/simConfig'

export function Library() {
  const [builtins, setBuiltins] = useState<Record<FunctionKind, BuiltinFunction[]> | null>(null)
  const [saved, setSaved] = useState<SavedFunction[]>([])
  const [kind, setKind] = useState<FunctionKind>('pairing')
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    loadBuiltins().then(setBuiltins)
    listFunctions().then(setSaved)
  }, [])

  if (!builtins) return <p className="text-sm text-ink-muted">Loading…</p>

  const mine = saved.filter((f) => f.kind === kind)
  const doc = HOOK_DOCS[kind]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-base font-semibold">Function library</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-muted">
          Every built-in is real Python from{' '}
          <code className="font-mono text-xs">public/py/builtins/</code> — the same file the engine
          executes and the test suite runs, so what you read here is what actually ran.
        </p>
      </div>

      <div className="flex flex-wrap gap-1">
        {FUNCTION_KINDS.map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              kind === k ? 'border-accent bg-accent text-accent-ink' : 'border-border hover:bg-surface-2'
            }`}
          >
            {HOOK_DOCS[k].title}
          </button>
        ))}
      </div>

      <div className="card p-4">
        <code className="text-xs text-accent">{doc.signature}</code>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">{doc.summary}</p>
      </div>

      <div className="space-y-2">
        {builtins[kind].map((b) => (
          <Entry
            key={b.id}
            name={b.name}
            description={b.description}
            code={b.code}
            open={open === b.id}
            onToggle={() => setOpen(open === b.id ? null : b.id)}
          />
        ))}
      </div>

      {mine.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium">
            Saved
            {isLocalOnly() && (
              <span className="ml-2 text-xs font-normal text-ink-muted">
                stored in this browser — set DATABASE_URL to share them
              </span>
            )}
          </h2>
          {mine.map((f) => (
            <Entry
              key={f.id}
              name={f.version && f.version > 1 ? `${f.name}  v${f.version}` : f.name}
              description={f.description}
              code={f.code}
              open={open === f.id}
              onToggle={() => setOpen(open === f.id ? null : f.id)}
              onDelete={async () => {
                await deleteFunction(f.id)
                setSaved(await listFunctions())
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Entry({
  name,
  description,
  code,
  open,
  onToggle,
  onDelete,
}: {
  name: string
  description: string
  code: string
  open: boolean
  onToggle: () => void
  onDelete?: () => void
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3">
        <button onClick={onToggle} className="flex-1 text-left">
          <div className="font-mono text-sm">{name}</div>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{description}</p>
        </button>
        {onDelete && (
          <button className="text-xs text-ink-muted hover:text-bad" onClick={onDelete}>
            delete
          </button>
        )}
        <button className="text-xs text-ink-muted" onClick={onToggle}>
          {open ? 'hide' : 'code'}
        </button>
      </div>
      {open && (
        <pre className="overflow-x-auto border-t border-border bg-surface px-4 py-3 text-[11.5px] leading-relaxed">
          {code}
        </pre>
      )}
    </div>
  )
}
