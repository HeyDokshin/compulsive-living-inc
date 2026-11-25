/**
 * Interiors: rooms (a museum hall, later houses) built in reserved corners of the voxel world.
 * The island generator always keeps the world's corners under open sea, so each interior gets one
 * corner chunk (16 × 16 cells). The room exists only while someone is inside: the owner builds it
 * on `interior:changed`, and on the way out the engine gives the corner back to the sea. While
 * inside, the renderer shows only that chunk.
 *
 * Pure state (no three.js): allocation, who is inside, save data. The Game wires it to rendering.
 */

export interface InteriorBox {
  /** First cell (inclusive) and size in cells. */
  x: number
  z: number
  w: number
  d: number
}

export interface Place {
  x: number
  y: number
  z: number
  rotY: number
}

export interface SavedInteriors {
  slots: Record<string, number>
  current: { id: string; back: Place } | null
}

export const CHUNK = 16

export class Interiors {
  private slots = new Map<string, number>()
  private inside: { id: string; back: Place } | null = null
  /** Called when the player goes in or out (the Game re-applies visibility and emits events). */
  onChange?: (id: string | null) => void

  constructor(private chunks: () => { x: number; z: number }) {}

  /** Corner chunks in a fixed order: they stay put however many interiors there are. */
  corners(): ReadonlyArray<{ cx: number; cz: number }> {
    const { x, z } = this.chunks()
    if (this.cached && this.cached.x === x && this.cached.z === z) return this.cached.list // asked for every entity, every frame
    const all = [
      { cx: 0, cz: 0 },
      { cx: x - 1, cz: 0 },
      { cx: 0, cz: z - 1 },
      { cx: x - 1, cz: z - 1 },
    ]
    const list = all.filter((c, i) => all.findIndex((o) => o.cx === c.cx && o.cz === c.cz) === i)
    this.cached = { x, z, list }
    return list
  }
  private cached: { x: number; z: number; list: Array<{ cx: number; cz: number }> } | null = null

  /** The room area of an interior (allocated on first use, then kept in the save). */
  area(id: string): InteriorBox {
    let slot = this.slots.get(id)
    if (slot === undefined) {
      const used = new Set(this.slots.values())
      slot = this.corners().findIndex((_, i) => !used.has(i))
      if (slot < 0) throw new Error(`no free corner for interior "${id}" (${this.slots.size} in use)`)
      this.slots.set(id, slot)
    }
    const c = this.corners()[slot]!
    return { x: c.cx * CHUNK, z: c.cz * CHUNK, w: CHUNK, d: CHUNK }
  }

  /** Rooms that have a corner. */
  ids(): string[] {
    return [...this.slots.keys()]
  }

  get current(): string | null {
    return this.inside?.id ?? null
  }

  /** Remember where the actor stood outside; the caller moves the actor in. */
  enter(id: string, back: Place): void {
    this.area(id)
    this.inside = { id, back: { ...back } }
    this.onChange?.(id)
  }

  /** Where to put the actor back outside (null if not inside). */
  exit(): Place | null {
    if (!this.inside) return null
    const back = this.inside.back
    this.inside = null
    this.onChange?.(null)
    return back
  }

  /** Is the chunk (cx, cz) shown? Inside: only the current room. Outside: everything. */
  chunkVisible(cx: number, cz: number): boolean {
    if (!this.inside) return true
    const c = this.corners()[this.slots.get(this.inside.id) ?? -1]
    return !!c && c.cx === cx && c.cz === cz
  }

  /** Is a world point shown? Inside: only points in the room. Outside: not the furniture of rooms
   * (their corners are open sea while nobody is in). */
  pointVisible(x: number, z: number): boolean {
    const cx = Math.floor(x / CHUNK)
    const cz = Math.floor(z / CHUNK)
    if (this.inside) return this.chunkVisible(cx, cz)
    for (const slot of this.slots.values()) {
      const c = this.corners()[slot]
      if (c && c.cx === cx && c.cz === cz) return false
    }
    return true
  }

  /** The room a point belongs to, if any. */
  roomAt(x: number, z: number): string | null {
    const cx = Math.floor(x / CHUNK)
    const cz = Math.floor(z / CHUNK)
    for (const [id, slot] of this.slots) {
      const c = this.corners()[slot]
      if (c && c.cx === cx && c.cz === cz) return id
    }
    return null
  }

  save(): SavedInteriors {
    return { slots: Object.fromEntries(this.slots), current: this.inside ? { id: this.inside.id, back: { ...this.inside.back } } : null }
  }

  load(data: SavedInteriors): void {
    this.slots = new Map(Object.entries(data.slots ?? {}))
    this.inside = data.current ? { id: data.current.id, back: { ...data.current.back } } : null
    this.onChange?.(this.current)
  }

  reset(): void {
    this.slots.clear()
    this.inside = null
    this.onChange?.(null)
  }
}
