import { meshChunk, type MeshInput, type MeshOutput } from './mesher'
import type { MeshRequest, MeshResponse } from './mesher.worker'

interface Pending {
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
      const w = new Worker(new URL('./mesher.worker.ts', import.meta.url), { type: 'module' })
      w.onmessage = (e: MessageEvent<MeshResponse>) => this.onResult(w, e.data)
      w.onerror = (e) => console.error('[mesher] worker error', e.message)
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

  mesh(input: MeshInput): Promise<MeshOutput> {
    if (!this.workers.length) return Promise.resolve(meshChunk(input))
    const id = this.nextId++
    const worker = [...this.busy].sort((a, b) => a[1] - b[1])[0]![0]
    this.busy.set(worker, this.busy.get(worker)! + 1)
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
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
