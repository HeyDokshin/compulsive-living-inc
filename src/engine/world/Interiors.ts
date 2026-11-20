/**
 * Interiors: rooms (a museum hall, later houses) built in reserved corners of the voxel world.
 * The island generator always keeps the world's corners under open sea, so each interior gets one
 * corner chunk (16 × 16 cells). While the player is inside, the renderer shows only that chunk;
 * outside, reserved chunks are hidden and the terrain draws sea over them.
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
  corners(): Array<{ cx: number; cz: number }> {
    const { x, z } = this.chunks()
    const all = [
      { cx: 0, cz: 0 },
      { cx: x - 1, cz: 0 },
      { cx: 0, cz: z - 1 },
      { cx: x - 1, cz: z - 1 },
    ]
    return all.filter((c, i) => all.findIndex((o) => o.cx === c.cx && o.cz === c.cz) === i)
  }

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

  /** Is the chunk (cx, cz) shown? Inside: only the current room. Outside: all but reserved corners. */
  chunkVisible(cx: number, cz: number): boolean {
    const box = this.inside ? this.area(this.inside.id) : null
    if (box) return cx === box.x / CHUNK && cz === box.z / CHUNK
    for (const slot of this.slots.values()) {
      const c = this.corners()[slot]
      if (c && c.cx === cx && c.cz === cz) return false
    }
    return true
  }

  /** Is a world point shown? (entities outside the current room are hidden while inside) */
  pointVisible(x: number, z: number): boolean {
    return this.chunkVisible(Math.floor(x / CHUNK), Math.floor(z / CHUNK))
  }

  /** Reserved areas (to draw sea over them from outside). */
  reserved(): InteriorBox[] {
    return [...this.slots.keys()].map((id) => this.area(id))
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
