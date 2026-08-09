/**
 * Module resolution hooks so `node --test` can run the TypeScript sources
 * as-written.
 *
 * Node 24 strips types natively, but its ESM resolver requires a full
 * specifier — it will not turn `./simConfig` into `./simConfig.ts` the way
 * webpack does, and it knows nothing about the `@/*` path alias. Rather than
 * add a test-runner dependency or write import extensions the rest of the
 * codebase does not use, these two hooks close the gap in about thirty lines.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CANDIDATES = ['.ts', '.tsx', '/index.ts', '/index.tsx']

export async function resolve(specifier, context, next) {
  let spec = specifier

  // "@/lib/foo" -> "<root>/src/lib/foo"
  if (spec.startsWith('@/')) {
    spec = pathToFileURL(path.join(ROOT, 'src', spec.slice(2))).href
  }

  const relative = spec.startsWith('./') || spec.startsWith('../')
  const fileUrl = spec.startsWith('file:')

  if ((relative || fileUrl) && !/\.[a-z]+$/i.test(spec)) {
    const base = fileUrl
      ? fileURLToPath(spec)
      : path.resolve(path.dirname(fileURLToPath(context.parentURL ?? import.meta.url)), spec)

    for (const ext of CANDIDATES) {
      if (existsSync(base + ext)) return next(pathToFileURL(base + ext).href, context)
    }
  }

  return next(spec, context)
}
