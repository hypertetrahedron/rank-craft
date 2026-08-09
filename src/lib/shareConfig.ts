import { defaultConfig, simConfigSchema, type SimConfig } from './simConfig'

/**
 * Round-tripping a configuration through the URL.
 *
 * The whole config is far too big for a query string once five Python functions
 * are in it, so what travels is a *diff* against the defaults. Every schema
 * block defaults to "switched off", so a configuration that only changes the
 * ranking function carries only the ranking function — which keeps a shareable
 * link short enough to paste into a message.
 */

/** Recursively keep only what differs from `base`. */
function diff(value: unknown, base: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return JSON.stringify(value) === JSON.stringify(base) ? undefined : value
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const d = diff(v, (base as Record<string, unknown> | undefined)?.[k])
    if (d !== undefined) out[k] = d
  }
  return Object.keys(out).length ? out : undefined
}

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let binary = ''
  bytes.forEach((b) => (binary += String.fromCharCode(b)))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function encodeConfig(cfg: SimConfig): string {
  const payload = diff(cfg, defaultConfig()) ?? {}
  return toBase64Url(JSON.stringify(payload))
}

/** Returns null rather than throwing — a mangled link should not break the page. */
export function decodeConfig(encoded: string): SimConfig | null {
  try {
    const patch = JSON.parse(fromBase64Url(encoded)) as Record<string, unknown>
    const base = defaultConfig()
    const merged = {
      ...base,
      ...patch,
      skill: { ...base.skill, ...(patch.skill as object) },
      variance: { ...base.variance, ...(patch.variance as object) },
      matchup: { ...base.matchup, ...(patch.matchup as object) },
      side: { ...base.side, ...(patch.side as object) },
      fatigue: { ...base.fatigue, ...(patch.fatigue as object) },
      initial_rating: { ...base.initial_rating, ...(patch.initial_rating as object) },
      functions: Object.fromEntries(
        Object.entries(base.functions).map(([k, v]) => [
          k,
          { ...v, ...((patch.functions as Record<string, object> | undefined)?.[k] ?? {}) },
        ])
      ),
    }
    const parsed = simConfigSchema.safeParse(merged)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function shareUrl(cfg: SimConfig): string {
  const url = new URL(window.location.href)
  url.hash = ''
  url.search = `?c=${encodeConfig(cfg)}`
  return url.toString()
}
