/// <reference lib="webworker" />
/**
 * One Pyodide instance running a slice of the replication batch.
 *
 * The whole slice runs inside Python. The worker crosses the JS/Python boundary
 * exactly twice per batch (once in, once out) plus a progress ping — doing it
 * per round would dominate the runtime.
 */
import type { WorkerIn, WorkerOut } from '@/lib/pyodide/protocol'

declare const self: DedicatedWorkerGlobalScope

type PyodideAPI = {
  runPython: (code: string) => unknown
  runPythonAsync: (code: string) => Promise<unknown>
  loadPackage: (pkg: string | string[]) => Promise<void>
  globals: { set: (k: string, v: unknown) => void; delete: (k: string) => void }
  FS: { writeFile: (path: string, data: string) => void; mkdirTree: (path: string) => void }
}

let py: PyodideAPI | null = null

const post = (msg: WorkerOut) => self.postMessage(msg)

async function init(msg: Extract<WorkerIn, { type: 'init' }>) {
  post({ type: 'status', stage: 'loading-runtime' })

  // webpackIgnore keeps the bundler from trying to resolve a remote URL.
  const mod = await import(/* webpackIgnore: true */ `${msg.pyodideUrl}pyodide.mjs`)
  py = (await mod.loadPyodide({ indexURL: msg.pyodideUrl })) as PyodideAPI

  if (msg.wheels.length) {
    post({ type: 'status', stage: 'loading-packages' })
    // Installed by URL rather than by name: that skips Pyodide's dependency
    // resolution, whose lock entry for networkx conservatively pulls in
    // matplotlib. networkx 3.x and numpy need nothing at import time.
    for (const wheel of msg.wheels) {
      await py.loadPackage(new URL(wheel, self.location.origin).href)
    }
  }

  post({ type: 'status', stage: 'loading-harness' })
  py.FS.mkdirTree('/rankcraft')
  py.FS.writeFile('/rankcraft/metrics.py', msg.sources.metrics)
  py.FS.writeFile('/rankcraft/harness.py', msg.sources.harness)
  await py.runPythonAsync(`
import sys
if '/rankcraft' not in sys.path:
    sys.path.insert(0, '/rankcraft')
import harness
`)
  post({ type: 'ready' })
}

function run(msg: Extract<WorkerIn, { type: 'run' }>) {
  if (!py) throw new Error('worker used before init')
  const { runId, config } = msg

  py.globals.set('_cfg', config)
  py.globals.set('_progress', (done: number, total: number) =>
    post({ type: 'progress', runId, done, total })
  )
  try {
    const raw = py.runPython(`harness.run_batch(_cfg, _progress)`) as string
    const parsed = JSON.parse(raw)
    if (parsed.ok) {
      post({ type: 'result', runId, payload: parsed })
    } else {
      post({ type: 'error', runId, error: parsed.error, trace: parsed.trace })
    }
  } finally {
    py.globals.delete('_cfg')
    py.globals.delete('_progress')
  }
}

self.onmessage = async (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data
  try {
    if (msg.type === 'init') {
      await init(msg)
    } else if (msg.type === 'run') {
      run(msg)
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    if (msg.type === 'init') post({ type: 'initError', error })
    else post({ type: 'error', runId: msg.runId, error })
  }
}

export {}
