import type { Entities } from '../ecs/Entities'
import type { Entity } from '../types'

/** A number per cell (asked many times per tick: no strings). */
const cellKey = (x: number, z: number) => (x + 32768) * 65536 + (z + 32768)

/**
 * Index of entities that block walking (`blocker` component: footprint w × d cells around the
 * entity, h cells tall). Trees, rocks, buildings… The engine answers `movement:blocked` from it.
 */
export class Blockers {
  private cells = new Map<number, { y: number; h: number; entity: Entity }>()
  private owned = new WeakMap<Entity, number[]>()

  constructor(entities: Entities) {
    const q = entities.world.with('blocker', 'transform')
    q.onEntityAdded.subscribe((e) => this.add(e))
    q.onEntityRemoved.subscribe((e) => this.remove(e))
    for (const e of q) this.add(e)
  }

  /** The cells an entity covers. */
  static footprint(e: Entity): Array<[number, number]> {
    const t = e.transform!
    const w = e.blocker?.w ?? 1
    const d = e.blocker?.d ?? 1
    const x0 = Math.floor(t.x - w / 2 + 0.001)
    const z0 = Math.floor(t.z - d / 2 + 0.001)
    const out: Array<[number, number]> = []
    for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) out.push([x0 + dx, z0 + dz])
    return out
  }

  at(x: number, z: number): Entity | undefined {
    return this.cells.get(cellKey(x, z))?.entity
  }

  /** Is (x, y, z) inside a blocker (from just under its base to its height)? */
  isBlocked(x: number, y: number, z: number): boolean {
    const c = this.cells.get(cellKey(x, z))
    return !!c && y >= c.y - 1 && y <= c.y + c.h
  }

  /** Re-index one entity after it moved or changed size. */
  update(e: Entity): void {
    this.remove(e)
    if (e.blocker && e.transform) this.add(e)
  }

  private add(e: Entity): void {
    const keys = Blockers.footprint(e).map(([x, z]) => cellKey(x, z))
    const y = Math.round(e.transform!.y)
    const h = e.blocker?.h ?? 3
    for (const k of keys) this.cells.set(k, { y, h, entity: e })
    this.owned.set(e, keys)
  }

  private remove(e: Entity): void {
    for (const k of this.owned.get(e) ?? []) if (this.cells.get(k)?.entity === e) this.cells.delete(k)
    this.owned.delete(e)
  }
}
