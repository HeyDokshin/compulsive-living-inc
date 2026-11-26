import type { Registry } from '../registry/Registry'
import { createLogger } from '../util/log'
import { renderMaterial } from './generate'
import type { MaterialRequest, MaterialResponse } from './material.worker'
// Inlined as a blob so the game also runs from a single HTML file opened via file://.
import MaterialWorker from './material.worker?worker&inline'
import type { MaterialDef } from './schema'

const log = createLogger('materials')

/**
 * Renders procedural materials (the `materials` registry) at any size, off the main thread, and
 * keeps recent results. A changed material drops its cached pictures.
 */
export class MaterialService {
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, (pixels: Uint8ClampedArray | null) => void>()
  private cache = new Map<string, Promise<Uint8ClampedArray | null>>()
  /** Bumps when any material changes (callers rebuild what they made from them). */
  version = 0

  constructor(private registry: Registry<MaterialDef>) {
    registry.onChange(() => {
      this.cache.clear()
      this.version++
    })
    if (typeof Worker === 'undefined') return
    try {
      const w = new MaterialWorker()
      w.onmessage = (e: MessageEvent<MaterialResponse>) => {
        const done = this.pending.get(e.data.id)
        this.pending.delete(e.data.id)
        if (e.data.error) log.error(e.data.error)
        done?.(e.data.pixels ?? null)
      }
      w.onerror = (e) => {
        log.error('worker error', e.message)
        for (const done of this.pending.values()) done(null)
        this.pending.clear()
      }
      this.worker = w
    } catch (e) {
      log.warn('workers unavailable, materials render on the main thread', e)
    }
  }

  has(id: string): boolean {
    return this.registry.has(id)
  }

  /** RGBA pixels, `size`×`size`, row 0 at the top. Null for unknown materials or failures. */
  render(id: string, size: number): Promise<Uint8ClampedArray | null> {
    const key = `${id}@${size}`
    let p = this.cache.get(key)
    if (!p) {
      const def = this.registry.get(id)
      if (!def) {
        log.warn(`unknown material "${id}"`)
        return Promise.resolve(null)
      }
      p = this.run(def, size)
      this.cache.set(key, p)
      // keep the last few dozen pictures
      if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!)
    }
    return p
  }

  private run(def: MaterialDef, size: number): Promise<Uint8ClampedArray | null> {
    const w = this.worker
    if (!w) {
      try {
        return Promise.resolve(renderMaterial(def, size))
      } catch (e) {
        log.error(`material "${def.id}":`, e)
        return Promise.resolve(null)
      }
    }
    const id = this.nextId++
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      w.postMessage({ id, def, size } satisfies MaterialRequest)
    })
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    for (const done of this.pending.values()) done(null)
    this.pending.clear()
  }
}
