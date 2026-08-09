import { FAIRNESS_METRICS, FINAL_METRICS, PYODIDE_URL, ROUND_METRICS, WHEELS } from './protocol'
import type { BatchResult, Maybe, WorkerIn, WorkerOut } from './protocol'
import type { EngineConfig, SimConfig } from '../simConfig'

export type PoolStatus =
  | { phase: 'idle' }
  | { phase: 'booting'; detail: string }
  | { phase: 'ready' }
  | { phase: 'running'; done: number; total: number }
  | { phase: 'failed'; error: string }

const STAGE_TEXT: Record<string, string> = {
  'loading-runtime': 'Downloading the Python runtime (~10 MB, cached after the first run)',
  'loading-packages': 'Loading the scientific libraries this configuration needs',
  'loading-harness': 'Starting the simulation harness',
}

/**
 * Which wheels this configuration actually needs, by looking at the code that
 * is about to run. numpy alone is 11 MB, so loading it unconditionally would
 * make every first run slow for the majority of configurations that never
 * touch it.
 */
export function requiredWheels(cfg: SimConfig): string[] {
  const code = Object.values(cfg.functions)
    .map((f) => f.code)
    .join('\n')
  return WHEELS.filter(
    (w) =>
      code.includes(w.module) ||
      // max_weight_pairing is the harness helper that imports networkx for you
      (w.module === 'networkx' && code.includes('max_weight_pairing'))
  ).map((w) => w.url)
}

/**
 * A pool of Pyodide workers, each running a contiguous slice of the replication
 * batch. Slices are contiguous and merged in order, so the merged result is
 * byte-identical regardless of how many workers ran it — pool size is a
 * performance knob, never a correctness one.
 */
export class CancelledError extends Error {
  constructor() {
    super('cancelled')
    this.name = 'CancelledError'
  }
}

export class SimPool {
  private workers: Worker[] = []
  private sources: { harness: string; metrics: string } | null = null
  private loadedWheels: string[] = []
  private booted = false
  private bootPromise: Promise<void> | null = null
  /** Rejecters for every in-flight slice, so cancelling settles them. */
  private inFlight = new Set<(err: Error) => void>()
  private listeners = new Set<(s: PoolStatus) => void>()

  readonly size: number

  constructor(size: number = defaultPoolSize()) {
    this.size = size
  }

  /**
   * Several components observe the pool at once (the run step and every
   * function picker), so this is a subscriber set rather than a single callback
   * slot — assigning one would silently leave every earlier observer stale.
   */
  subscribe(fn: (s: PoolStatus) => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private onStatus(s: PoolStatus) {
    this.listeners.forEach((fn) => fn(s))
  }

  async boot(wheels: string[]): Promise<void> {
    if (this.booted) {
      // A later run may select a function needing a wheel the live workers were
      // not started with. Rebuilding is cheap next to silently falling back to
      // a slower code path or failing on an import.
      if (wheels.some((w) => !this.loadedWheels.includes(w))) {
        this.dispose()
      } else {
        return
      }
    }
    if (this.bootPromise) return this.bootPromise
    this.bootPromise = this.doBoot(wheels)
    return this.bootPromise
  }

  private async doBoot(wheels: string[]) {
    this.onStatus({ phase: 'booting', detail: 'Fetching the simulation engine' })
    const [harness, metrics] = await Promise.all([
      fetch('/py/harness.py').then((r) => r.text()),
      fetch('/py/metrics.py').then((r) => r.text()),
    ])
    this.sources = { harness, metrics }

    const init: WorkerIn = {
      type: 'init',
      pyodideUrl: PYODIDE_URL,
      sources: this.sources,
      wheels,
    }
    this.loadedWheels = wheels

    await Promise.all(
      Array.from({ length: this.size }, () => {
        const w = new Worker(new URL('../../workers/sim.worker.ts', import.meta.url), {
          type: 'module',
        })
        this.workers.push(w)
        return new Promise<void>((resolve, reject) => {
          const onMessage = (ev: MessageEvent<WorkerOut>) => {
            const m = ev.data
            if (m.type === 'status') {
              this.onStatus({ phase: 'booting', detail: STAGE_TEXT[m.stage] ?? m.stage })
            } else if (m.type === 'ready') {
              w.removeEventListener('message', onMessage)
              resolve()
            } else if (m.type === 'initError') {
              w.removeEventListener('message', onMessage)
              reject(new Error(m.error))
            }
          }
          w.addEventListener('message', onMessage)
          w.postMessage(init)
        })
      })
    )
    this.booted = true
    this.onStatus({ phase: 'ready' })
  }

  /** Run `cfg.replications` tournaments across the pool and merge the slices. */
  async run(cfg: SimConfig, runId = String(Date.now())): Promise<BatchResult> {
    await this.boot(requiredWheels(cfg))

    const slices = partition(cfg.replications, this.workers.length)
    const total = cfg.replications
    const progress = new Array(slices.length).fill(0)
    this.onStatus({ phase: 'running', done: 0, total })

    const results = await Promise.all(
      slices.map((ids, i) => {
        const engineCfg: EngineConfig = {
          ...cfg,
          replication_ids: ids,
          // only the first slice carries a full tournament log for the inspector
          want_log: i === 0,
        }
        return this.runOn(this.workers[i], runId, engineCfg, (done) => {
          progress[i] = done
          const sum = progress.reduce((a, b) => a + b, 0)
          this.onStatus({ phase: 'running', done: sum, total })
        })
      })
    )

    const merged = mergeSlices(results)
    this.onStatus({ phase: 'ready' })
    return merged
  }

  private runOn(
    worker: Worker,
    runId: string,
    cfg: EngineConfig,
    onProgress: (done: number) => void
  ): Promise<BatchResult> {
    if (cfg.replication_ids.length === 0) return Promise.resolve(emptyResult())
    return new Promise((resolve, reject) => {
      const settle = () => {
        worker.removeEventListener('message', onMessage)
        this.inFlight.delete(reject)
      }
      const onMessage = (ev: MessageEvent<WorkerOut>) => {
        const m = ev.data
        if (m.type === 'progress' && m.runId === runId) {
          onProgress(m.done)
        } else if (m.type === 'result' && m.runId === runId) {
          settle()
          resolve(m.payload)
        } else if (m.type === 'error' && m.runId === runId) {
          settle()
          const err = new Error(m.error)
          if (m.trace) (err as Error & { trace?: string }).trace = m.trace
          reject(err)
        }
      }
      // Terminating a worker never fires an event, so without this the promise
      // would simply never settle and `run()` would hang for the page's lifetime.
      this.inFlight.add(reject)
      worker.addEventListener('message', onMessage)
      worker.postMessage({ type: 'run', runId, config: JSON.stringify(cfg) } satisfies WorkerIn)
    })
  }

  /**
   * Stop the current run. Pyodide cannot be interrupted mid-computation without
   * SharedArrayBuffer (which needs COOP/COEP headers — see ADR-004), so
   * cancelling means discarding the workers and booting fresh ones.
   */
  cancel() {
    this.dispose()
  }

  dispose() {
    // Reject before terminating: the rejection is what unblocks any awaiting
    // caller, and after termination there is nothing left to deliver it.
    const pending = [...this.inFlight]
    this.inFlight.clear()
    pending.forEach((reject) => reject(new CancelledError()))

    this.workers.forEach((w) => w.terminate())
    this.workers = []
    this.booted = false
    this.bootPromise = null
    this.loadedWheels = []
    this.onStatus({ phase: 'idle' })
  }
}

export function defaultPoolSize(): number {
  if (typeof navigator === 'undefined') return 1
  return Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1))
}

/** Contiguous chunks so concatenating the slices reproduces a single-worker run. */
export function partition(total: number, workers: number): number[][] {
  const out: number[][] = []
  const base = Math.floor(total / workers)
  const extra = total % workers
  let next = 0
  for (let i = 0; i < workers; i++) {
    const size = base + (i < extra ? 1 : 0)
    out.push(Array.from({ length: size }, (_, k) => next + k))
    next += size
  }
  return out
}

function emptyResult(): BatchResult {
  const final = Object.fromEntries(FINAL_METRICS.map((m) => [m, [] as Maybe[]]))
  const fairness = Object.fromEntries(FAIRNESS_METRICS.map((m) => [m, [] as Maybe[]]))
  const perRound = Object.fromEntries(ROUND_METRICS.map((m) => [m, [] as Maybe[][]]))
  return {
    ok: true,
    version: '',
    replication_ids: [],
    final: final as BatchResult['final'],
    fairness: fairness as BatchResult['fairness'],
    per_round: perRound as BatchResult['per_round'],
    sample: null,
  }
}

export function mergeSlices(slices: BatchResult[]): BatchResult {
  const out = emptyResult()
  for (const s of slices) {
    out.version = s.version || out.version
    out.replication_ids.push(...s.replication_ids)
    for (const m of FINAL_METRICS) out.final[m].push(...(s.final[m] ?? []))
    for (const m of FAIRNESS_METRICS) out.fairness[m].push(...(s.fairness[m] ?? []))
    for (const m of ROUND_METRICS) out.per_round[m].push(...(s.per_round[m] ?? []))
    if (!out.sample && s.sample) out.sample = s.sample
  }
  return out
}
