'use client'

import { useEffect, useMemo, useState } from 'react'
import { HOOK_DOCS } from '@/lib/apiDocs'
import { loadBuiltins, looksLikeCheating, parseParams } from '@/lib/builtins'
import type { BuiltinFunction, ParamSpec } from '@/lib/builtins'
import { deleteFunction, isLocalOnly, listFunctions, saveFunction } from '@/lib/functionStore'
import type { SavedFunction } from '@/lib/functionStore'
import { usePool } from '@/lib/pyodide/usePool'
import type { FunctionKind } from '@/lib/simConfig'
import { useWizard } from '@/lib/store/wizard'
import { ApiReference } from './ApiReference'
import { ParamControls } from './ParamControls'
import { PythonEditor } from './PythonEditor'

type Entry = BuiltinFunction | SavedFunction

export function FunctionPicker({ kind }: { kind: FunctionKind }) {
  const doc = HOOK_DOCS[kind]
  const ref = useWizard((s) => s.config.functions[kind])
  const config = useWizard((s) => s.config)
  const setFunction = useWizard((s) => s.setFunction)
  const { smoke } = usePool()

  const [builtins, setBuiltins] = useState<BuiltinFunction[]>([])
  const [saved, setSaved] = useState<SavedFunction[]>([])
  const [check, setCheck] = useState<{ state: 'idle' | 'running' | 'ok' | 'bad'; error?: string }>({
    state: 'idle',
  })
  const [saveName, setSaveName] = useState('')
  const [showSave, setShowSave] = useState(false)

  useEffect(() => {
    loadBuiltins().then((all) => setBuiltins(all[kind]))
    listFunctions(kind).then(setSaved)
  }, [kind])

  const entries: Entry[] = useMemo(() => [...builtins, ...saved], [builtins, saved])
  const specs: Record<string, ParamSpec> = useMemo(() => parseParams(ref.code), [ref.code])
  const cheating = looksLikeCheating(kind, ref.code) && ref.name !== 'oracle'

  // Editing invalidates the last smoke-test verdict.
  useEffect(() => setCheck({ state: 'idle' }), [ref.code])

  const select = (id: string) => {
    const entry = entries.find((e) => e.id === id)
    if (!entry) return
    setFunction(kind, {
      name: entry.name,
      sourceId: entry.id,
      code: entry.code,
      params: Object.fromEntries(
        Object.entries(parseParams(entry.code)).map(([k, v]) => [k, v.default])
      ),
    })
  }

  const runCheck = async () => {
    setCheck({ state: 'running' })
    const res = await smoke(config)
    setCheck(res.ok ? { state: 'ok' } : { state: 'bad', error: res.error })
  }

  const doSave = async () => {
    const name = saveName.trim()
    if (!name) return
    const fn = await saveFunction({
      kind,
      name,
      description: `Saved ${new Date().toLocaleDateString()}`,
      code: ref.code,
      params: specs,
    })
    setSaved(await listFunctions(kind))
    setFunction(kind, { name: fn.name, sourceId: fn.id })
    setShowSave(false)
    setSaveName('')
  }

  const removeSaved = async (id: string) => {
    await deleteFunction(id)
    setSaved(await listFunctions(kind))
    if (ref.sourceId === id) setFunction(kind, { sourceId: null })
  }

  const active = entries.find((e) => e.id === ref.sourceId)
  const dirty = active ? active.code !== ref.code : true

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="input max-w-sm flex-1"
          value={dirty ? '' : (ref.sourceId ?? '')}
          onChange={(e) => select(e.target.value)}
        >
          <option value="" disabled>
            {dirty ? `${ref.name} (edited)` : 'Pick a function…'}
          </option>
          <optgroup label="Built in">
            {builtins.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </optgroup>
          {saved.length > 0 && (
            <optgroup label={isLocalOnly() ? 'Saved (this browser only)' : 'Saved'}>
              {saved.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>

        <button className="btn" onClick={runCheck} disabled={check.state === 'running'}>
          {check.state === 'running' ? 'Checking…' : 'Test'}
        </button>
        <button className="btn" onClick={() => setShowSave((v) => !v)}>
          Save as…
        </button>
        {active && !('isBuiltin' in active && active.isBuiltin) && (
          <button className="btn text-bad" onClick={() => removeSaved(active.id)}>
            Delete
          </button>
        )}
      </div>

      {showSave && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface p-2">
          <input
            className="input flex-1"
            placeholder="Name this function"
            value={saveName}
            autoFocus
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSave()}
          />
          <button className="btn btn-primary" onClick={doSave} disabled={!saveName.trim()}>
            Save
          </button>
        </div>
      )}

      {active && !dirty && (
        <p className="text-xs leading-relaxed text-ink-muted">{active.description}</p>
      )}

      {check.state === 'ok' && (
        <p className="text-xs text-ok">
          Ran an 8-player, 3-round tournament without complaint.
        </p>
      )}
      {check.state === 'bad' && (
        <pre className="whitespace-pre-wrap rounded-md border border-bad/40 bg-bad/5 p-2 text-[11px] leading-relaxed text-bad">
          {check.error}
        </pre>
      )}
      {cheating && (
        <p className="text-xs text-warn">
          This code reads <code className="font-mono">.skill</code>, which is ground truth. Only the{' '}
          <code className="font-mono">oracle</code> baseline is meant to — anything else will score
          near-perfectly for the wrong reason.
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <PythonEditor value={ref.code} onChange={(code) => setFunction(kind, { code })} />
          <ParamControls
            specs={specs}
            values={ref.params}
            onChange={(params) => setFunction(kind, { params })}
          />
        </div>
        <div className="max-h-[560px]">
          <ApiReference doc={doc} />
        </div>
      </div>
    </div>
  )
}
