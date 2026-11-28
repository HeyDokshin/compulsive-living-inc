/**
 * Interiors: rooms (a museum hall, your house…) that are worlds of their own. Going in loads the
 * room into a small voxel world of its own (the owner builds it on `interior:changed`); the island
 * stays as it is, hidden and paused, until you come back out. Entities in a room carry its id in
 * `space`; everything else is on the island.
 *
 * Pure state (no three.js): who is inside, where they came from, room sizes, save data. The Game
 * owns the worlds and the switching.
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
  current: { id: string; back: Place } | null
  /** Where each room's world lies (its number: see `originOf`). */
  rooms: Record<string, number>
}

/** Version 1 saves: rooms lived in corner chunks of the island. */
export interface SavedInteriorsV1 {
  current: { id: string; back: Place } | null
  slots?: Record<string, number>
  rooms?: Record<string, number>
}

export const CHUNK = 16

/** A room world: this many chunks across, the room in its middle with a margin around it. */
export const ROOM_CHUNKS = 2
export const ROOM_MARGIN = 8
/** The biggest room (cells, walls included). */
export const ROOM_SIZE = ROOM_CHUNKS * CHUNK - 2 * ROOM_MARGIN
/** Rooms lie far off the island (past any island size), side by side: nothing in a room ever shares a
 * cell with something outside. Small enough numbers to stay exact on the GPU. */
export const ROOMS_FROM = 2048
export const ROOM_STRIDE = ROOM_CHUNKS * CHUNK * 2

/** World coordinates of the first cell of room number n's world. */
export function originOf(n: number): { x: number; z: number } {
  return { x: ROOMS_FROM + n * ROOM_STRIDE, z: ROOMS_FROM }
}

export class Interiors {
  private inside: { id: string; back: Place } | null = null
  private numbers = new Map<string, number>()

  /** A room's number (given on first use, then kept in the save): where its world lies. */
  numberOf(id: string): number {
    let n = this.numbers.get(id)
    if (n === undefined) {
      n = this.numbers.size ? Math.max(...this.numbers.values()) + 1 : 0
      this.numbers.set(id, n)
    }
    return n
  }

  /** First cell of a room's world (world coordinates). */
  origin(id: string): { x: number; z: number } {
    return originOf(this.numberOf(id))
  }

  /** The room area in its world (world coordinates): where the owner builds it. */
  area(id: string): InteriorBox {
    const o = this.origin(id)
    return { x: o.x + ROOM_MARGIN, z: o.z + ROOM_MARGIN, w: ROOM_SIZE, d: ROOM_SIZE }
  }

  /** The room a point belongs to (rooms are far off the island), or null on the island. */
  roomAt(x: number, z: number): string | null {
    if (x < ROOMS_FROM && z < ROOMS_FROM) return null
    for (const [id, n] of this.numbers) {
      const o = originOf(n)
      if (x >= o.x && x < o.x + ROOM_CHUNKS * CHUNK && z >= o.z && z < o.z + ROOM_CHUNKS * CHUNK) return id
    }
    return null
  }

  get current(): string | null {
    return this.inside?.id ?? null
  }

  /** Where the actor stood outside (to come back to). */
  get back(): Place | null {
    return this.inside ? { ...this.inside.back } : null
  }

  /** Remember where the actor stood outside. */
  enter(id: string, back: Place): void {
    // going from one room into another keeps the way back to the island
    this.inside = { id, back: this.inside ? this.inside.back : { ...back } }
  }

  /** Where to put the actor back outside (null if not inside). */
  exit(): Place | null {
    if (!this.inside) return null
    const back = this.inside.back
    this.inside = null
    return back
  }

  save(): SavedInteriors {
    return { current: this.inside ? { id: this.inside.id, back: { ...this.inside.back } } : null, rooms: Object.fromEntries(this.numbers) }
  }

  /**
   * Rooms ask for their area when their plugins load, before the save comes in: the saved numbers
   * win, rooms the save doesn't know keep theirs (or take a free one).
   */
  load(data: SavedInteriorsV1): void {
    this.inside = data.current ? { id: data.current.id, back: { ...data.current.back } } : null
    if (!data.rooms) return
    const known = new Map(this.numbers)
    this.numbers = new Map(Object.entries(data.rooms))
    const taken = new Set(this.numbers.values())
    for (const [id, n] of known) {
      if (this.numbers.has(id)) continue
      const free = taken.has(n) ? Math.max(-1, ...taken) + 1 : n
      this.numbers.set(id, free)
      taken.add(free)
    }
  }

  reset(): void {
    this.inside = null
    this.numbers.clear()
  }
}

/**
 * Version 1 → 2: rooms were corner chunks of the island (in the order below). Returns, per room,
 * the corner box it had, so its furniture can move into the room's own world.
 */
export function legacyCorners(data: SavedInteriorsV1, chunksX: number, chunksZ: number): Array<{ id: string; box: InteriorBox }> {
  const all = [
    { cx: 0, cz: 0 },
    { cx: chunksX - 1, cz: 0 },
    { cx: 0, cz: chunksZ - 1 },
    { cx: chunksX - 1, cz: chunksZ - 1 },
  ]
  const corners = all.filter((c, i) => all.findIndex((o) => o.cx === c.cx && o.cz === c.cz) === i)
  const out: Array<{ id: string; box: InteriorBox }> = []
  for (const [id, slot] of Object.entries(data.slots ?? {})) {
    const c = corners[slot]
    if (c) out.push({ id, box: { x: c.cx * CHUNK, z: c.cz * CHUNK, w: CHUNK, d: CHUNK } })
  }
  return out
}

/** Where a point of an old corner room lands in the room's own area (the old 16 × 16 area is centered in it). */
export function fromCorner(box: InteriorBox, area: InteriorBox, x: number, z: number): { x: number; z: number } {
  return { x: x - box.x + area.x + (area.w - CHUNK) / 2, z: z - box.z + area.z + (area.d - CHUNK) / 2 }
}
