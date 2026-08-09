import { FUNCTION_KINDS } from './simConfig'
import type { FunctionKind } from './simConfig'

/**
 * The built-in function library lives in public/py/builtins/*.py as real Python
 * that the self-test executes, split into editor snippets on `##-- name | desc --##`
 * markers. One source of truth: what you read in the picker is the file the
 * engine runs.
 */

export type ParamSpec = {
  default: number | string | boolean
  min?: number
  max?: number
  step?: number
}

export type BuiltinFunction = {
  id: string
  kind: FunctionKind
  name: string
  description: string
  code: string
  params: Record<string, ParamSpec>
  isBuiltin: true
}

const MARKER = /^##--\s*([a-z0-9_]+)\s*\|\s*([\s\S]*?)\s*--##\s*$/gm

export function splitBuiltins(kind: FunctionKind, source: string): BuiltinFunction[] {
  const marks: { name: string; description: string; markerStart: number; bodyStart: number }[] = []
  MARKER.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MARKER.exec(source))) {
    marks.push({
      name: m[1],
      description: m[2].trim().replace(/\s+/g, ' '),
      markerStart: m.index,
      bodyStart: m.index + m[0].length,
    })
  }
  return marks.map((mark, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].markerStart : source.length
    const code = source.slice(mark.bodyStart, end).trim()
    return {
      id: `builtin:${kind}:${mark.name}`,
      kind,
      name: mark.name,
      description: mark.description,
      code,
      params: parseParams(code),
      isBuiltin: true as const,
    }
  })
}

/**
 * Read a `PARAMS = {...}` literal out of user code so the UI can render controls
 * for it. Deliberately a narrow parser over number/string/bool literals rather
 * than an eval: the code is about to run in Pyodide anyway, but the picker
 * renders before anything is executed.
 */
export function parseParams(code: string): Record<string, ParamSpec> {
  const decl = /^PARAMS\s*=\s*\{/m.exec(code)
  if (!decl) return {}
  const start = decl.index + decl[0].length - 1

  // walk to the matching close brace
  let depth = 0
  let end = -1
  for (let i = start; i < code.length; i++) {
    if (code[i] === '{') depth++
    else if (code[i] === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end < 0) return {}

  const out: Record<string, ParamSpec> = {}
  const inner = code.slice(start + 1, end)
  const entry = /'([a-zA-Z_][a-zA-Z0-9_]*)'\s*:\s*\{([^}]*)\}/g
  let e: RegExpExecArray | null
  while ((e = entry.exec(inner))) {
    const spec: Record<string, number | string | boolean> = {}
    const field = /'([a-z]+)'\s*:\s*(-?[\d.]+|True|False|'[^']*')/g
    let f: RegExpExecArray | null
    while ((f = field.exec(e[2]))) {
      const raw = f[2]
      spec[f[1]] =
        raw === 'True' ? true : raw === 'False' ? false : raw.startsWith("'") ? raw.slice(1, -1) : Number(raw)
    }
    if ('default' in spec) out[e[1]] = spec as ParamSpec
  }
  return out
}

let cache: Promise<Record<FunctionKind, BuiltinFunction[]>> | null = null

export function loadBuiltins(): Promise<Record<FunctionKind, BuiltinFunction[]>> {
  if (cache) return cache
  cache = (async () => {
    const entries = await Promise.all(
      FUNCTION_KINDS.map(async (kind) => {
        const source = await fetch(`/py/builtins/${kind}.py`).then((r) => r.text())
        return [kind, splitBuiltins(kind, source)] as const
      })
    )
    return Object.fromEntries(entries) as Record<FunctionKind, BuiltinFunction[]>
  })()
  return cache
}

/** Sensible starting point for a fresh config. */
export const DEFAULT_BUILTIN: Record<FunctionKind, string> = {
  seeding: 'by_rating',
  pairing: 'dutch_slide',
  outcome: 'winner_takes_1',
  rating: 'none',
  ranking: 'buchholz',
}

/** Reference points worth pinning to a comparison. */
export const BASELINE_RANKINGS = ['oracle', 'initial_seed'] as const

/**
 * True skill is ground truth: a pairing or ranking function that reads it is
 * cheating. `oracle` is the one legitimate use, so it is exempt.
 */
export function looksLikeCheating(kind: FunctionKind, code: string): boolean {
  if (kind !== 'pairing' && kind !== 'ranking') return false
  return /\.skill\b/.test(code)
}
