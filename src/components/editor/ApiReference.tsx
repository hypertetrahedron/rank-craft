'use client'

import { useState } from 'react'
import type { HookDoc } from '@/lib/apiDocs'

/**
 * The "what you can use" panel. Rendered from lib/apiDocs.ts so there is one
 * place to update when the harness contract changes.
 */
export function ApiReference({ doc }: { doc: HookDoc }) {
  const [open, setOpen] = useState<string | null>(doc.sections[0]?.title ?? null)

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md border border-border">
      <div className="border-b border-border bg-surface px-3 py-2">
        <code className="block break-words text-[11.5px] leading-relaxed text-accent">
          {doc.signature}
        </code>
        <p className="mt-2 text-xs leading-relaxed text-ink-muted">{doc.summary}</p>
      </div>

      <div className="border-b border-border px-3 py-2">
        <div className="label mb-1">Must hold</div>
        <ul className="space-y-0.5 text-xs text-ink-muted">
          {doc.contract.map((c) => (
            <li key={c} className="flex gap-1.5">
              <span className="text-accent">·</span>
              <span>{c}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {doc.sections.map((section) => {
          const isOpen = open === section.title
          return (
            <div key={section.title} className="border-b border-border last:border-0">
              <button
                onClick={() => setOpen(isOpen ? null : section.title)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium hover:bg-surface"
              >
                <span>{section.title}</span>
                <span className="text-ink-muted">{isOpen ? '−' : '+'}</span>
              </button>
              {isOpen && (
                <div className="px-3 pb-3">
                  {section.subtitle && (
                    <p className="mb-2 text-[11px] text-ink-muted">{section.subtitle}</p>
                  )}
                  <dl className="space-y-2">
                    {section.fields.map((f) => (
                      <div key={f.name}>
                        <dt className="font-mono text-[11.5px]">
                          <span className="text-ink">{f.name}</span>{' '}
                          <span className="text-ink-muted">{f.type}</span>
                        </dt>
                        <dd className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">{f.doc}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
