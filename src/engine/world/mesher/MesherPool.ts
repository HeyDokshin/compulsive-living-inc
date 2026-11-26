import type { MeshOutput } from './mesher'
import { runMeshJob, type MeshJob } from './meshJob'
import type { MeshRequest, MeshResponse } from './mesher.worker'
// Inlined as a blob so the game also runs from a single HTML file opened via file://.
import MesherWorker from './mesher.worker?worker&inline'

interface Pending {
  worker: Worker
  resolve(out: MeshOutput): void
  reject(err: Error): void
}

/** Round-robin pool of mesher workers. Falls back to the main thread where workers are unavailable. */
export class MesherPool {
  private workers: Worker[] = []
  private pending = new Map<number, Pending>()
  private busy = new Map<Worker, number>()
  private nextId = 1

  constructor(size = Math.max(1, Math.min(4, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1))) {
    if (typeof Worker === 'undefined') return
    for (let i = 0; i < size; i++) {
      let w: Worker
      try {
        w = new MesherWorker()
      } catch (e) {
        // Some browsers refuse workers on file:// pages: mesh on the main thread instead.
        console.warn('[mesher] workers unavailable, meshing on the main thread', e)
        break
      }
      w.onmessage = (e: MessageEvent<MeshResponse>) => this.onResult(w, e.data)
      w.onerror = (e) => {
        console.error('[mesher] worker error', e.message)
        // Fail its jobs so callers re-queue them instead of waiting forever.
        for (const [id, p] of this.pending) {
          if (p.worker !== w) continue
          this.pending.delete(id)
          p.reject(new Error(`mesher worker crashed: ${e.message}`))
        }
        this.busy.set(w, 0)
      }
      this.workers.push(w)
      this.busy.set(w, 0)
    }
  }

  /** Jobs currently being meshed. */
  get inFlight(): number {
    return this.pending.size
  }

  get capacity(): number {
    return Math.max(1, this.workers.length) * 4
  }

  mesh(input: MeshJob): Promise<MeshOutput> {
    if (!this.workers.length) return Promise.resolve(runMeshJob(input))
    const id = this.nextId++
    const worker = [...this.busy].sort((a, b) => a[1] - b[1])[0]![0]
    this.busy.set(worker, this.busy.get(worker)! + 1)
    return new Promise((resolve, reject) => {
      this.pending.set(id, { worker, resolve, reject })
      worker.postMessage({ id, input } satisfies MeshRequest, [input.vol.buffer as ArrayBuffer])
    })
  }

  dispose(): void {
    for (const w of this.workers) w.terminate()
    this.workers = []
    for (const p of this.pending.values()) p.reject(new Error('mesher disposed'))
    this.pending.clear()
  }

  private onResult(worker: Worker, res: MeshResponse): void {
    this.busy.set(worker, Math.max(0, (this.busy.get(worker) ?? 1) - 1))
    const p = this.pending.get(res.id)
    if (!p) return
    this.pending.delete(res.id)
    if (res.output) p.resolve(res.output)
    else p.reject(new Error(res.error ?? 'mesher failed'))
  }
}
