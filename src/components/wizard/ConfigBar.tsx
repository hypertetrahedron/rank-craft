'use client'

import { useEffect, useState } from 'react'
import { listConfigs, remoteEnabled, saveConfig, type StoredConfig } from '@/lib/runStore'
import { decodeConfig, shareUrl } from '@/lib/shareConfig'
import { useWizard } from '@/lib/store/wizard'

/**
 * Saving, loading and sharing the whole setup.
 *
 * A link carries a diff against the defaults rather than the whole object, so a
 * configuration that only swaps the ranking function produces a link short
 * enough to paste into a message.
 */
export function ConfigBar() {
  const config = useWizard((s) => s.config)
  const patch = useWizard((s) => s.patch)
  const [saved, setSaved] = useState<StoredConfig[]>([])
  const [name, setName] = useState('')
  const [showSave, setShowSave] = useState(false)
  const [copied, setCopied] = useState(false)
  const [loadedFromUrl, setLoadedFromUrl] = useState(false)

  useEffect(() => {
    listConfigs().then(setSaved)
  }, [])

  // A shared link wins over whatever was persisted locally, then the parameter
  // is stripped so a later reload does not silently undo the user's edits.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const encoded = params.get('c')
    if (!encoded) return
    const decoded = decodeConfig(encoded)
    if (decoded) {
      patch(decoded)
      setLoadedFromUrl(true)
    }
    params.delete('c')
    const rest = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''))
  }, [patch])

  const doSave = async () => {
    const label = name.trim()
    if (!label) return
    await saveConfig(label, config)
    setSaved(await listConfigs())
    setName('')
    setShowSave(false)
  }

  const copyLink = async () => {
    await navigator.clipboard.writeText(shareUrl(config))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {saved.length > 0 && (
          <select
            className="input w-auto max-w-xs"
            value=""
            onChange={(e) => {
              const found = saved.find((c) => c.id === e.target.value)
              if (found) patch(found.payload)
            }}
          >
            <option value="">Load a saved setup…</option>
            {saved.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <button className="btn" onClick={() => setShowSave((v) => !v)}>
          Save setup
        </button>
        <button className="btn" onClick={copyLink}>
          {copied ? 'Link copied' : 'Copy share link'}
        </button>
        {!remoteEnabled() && saved.length > 0 && (
          <span className="text-[11px] text-ink-muted">saved in this browser only</span>
        )}
      </div>

      {showSave && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface p-2">
          <input
            className="input flex-1"
            placeholder="Name this setup"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSave()}
          />
          <button className="btn btn-primary" onClick={doSave} disabled={!name.trim()}>
            Save
          </button>
        </div>
      )}

      {loadedFromUrl && (
        <p className="text-xs text-ok">Loaded a shared setup from the link.</p>
      )}
    </div>
  )
}
