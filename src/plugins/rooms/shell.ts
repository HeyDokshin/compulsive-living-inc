/**
 * The shell of a room, planned (pure, tested): which walls there are, where their openings are and
 * which pieces of wall stand around those openings. The room is a w × d ring of wall cells around
 * the floor; walls are thin slabs on the inner side of that ring.
 */

export type Side = 'north' | 'south' | 'west' | 'east'
export const SIDES: readonly Side[] = ['north', 'south', 'west', 'east']

export interface RoomBox {
  /** First cell (world) and size in cells, the wall ring included. */
  x0: number
  z0: number
  w: number
  d: number
}

export interface Opening {
  kind: 'door' | 'window'
  /** Along the wall (world units): from, to. */
  a: number
  b: number
}

/** A wall: the plane of its inner face, the span it runs along, and which way it faces out. */
export interface WallRun {
  side: Side
  /** Inner face: x = plane (west / east) or z = plane (north / south). */
  plane: number
  /** Along the wall: world z (west / east) or x (north / south). */
  from: number
  to: number
  /** Outward unit normal (x, z). */
  out: [number, number]
  openings: Opening[]
}

/** A box of wall: along [a, b], heights [y0, y1] above the floor. */
export interface Piece {
  a: number
  b: number
  y0: number
  y1: number
}

/** The side a border cell is on (corners count as north / south). */
export function sideOf(box: RoomBox, x: number, z: number): Side | null {
  if (z === box.z0) return 'north'
  if (z === box.z0 + box.d - 1) return 'south'
  if (x === box.x0) return 'west'
  if (x === box.x0 + box.w - 1) return 'east'
  return null
}

/**
 * The four walls of a room with their openings (door and window cells on the ring). Neighbouring
 * opening cells of one kind merge (a double door). North / south walls run the full width (they
 * close the corners); west / east fit between them.
 */
export function planWalls(
  box: RoomBox,
  doors: ReadonlyArray<{ x: number; z: number }>,
  windows: ReadonlyArray<{ x: number; z: number }>,
  thick: number,
): WallRun[] {
  const { x0, z0, w, d } = box
  const runs: Record<Side, WallRun> = {
    north: {
      side: 'north',
      plane: z0 + 1,
      from: x0 + 1 - thick,
      to: x0 + w - 1 + thick,
      out: [0, -1],
      openings: [],
    },
    south: {
      side: 'south',
      plane: z0 + d - 1,
      from: x0 + 1 - thick,
      to: x0 + w - 1 + thick,
      out: [0, 1],
      openings: [],
    },
    west: { side: 'west', plane: x0 + 1, from: z0 + 1, to: z0 + d - 1, out: [-1, 0], openings: [] },
    east: { side: 'east', plane: x0 + w - 1, from: z0 + 1, to: z0 + d - 1, out: [1, 0], openings: [] },
  }
  const add = (kind: Opening['kind'], cells: ReadonlyArray<{ x: number; z: number }>) => {
    for (const c of cells) {
      const side = sideOf(box, c.x, c.z)
      if (!side) continue
      const along = side === 'north' || side === 'south' ? c.x : c.z
      const list = runs[side].openings
      const prev = list.find((o) => o.kind === kind && (o.b === along || o.a === along + 1))
      if (prev) {
        prev.a = Math.min(prev.a, along)
        prev.b = Math.max(prev.b, along + 1)
      } else list.push({ kind, a: along, b: along + 1 })
    }
  }
  add('door', doors)
  add('window', windows)
  for (const r of SIDES) runs[r].openings.sort((p, q) => p.a - q.a)
  return SIDES.map((s) => runs[s])
}

/**
 * The boxes a wall is made of: whole pieces between openings, and around each opening what is
 * below and above it (a door from the floor up to `doorTop`, a window from `sill` to `top`).
 */
export function wallPieces(run: WallRun, height: number, door: { top: number }, window: { sill: number; top: number }): Piece[] {
  const out: Piece[] = []
  let at = run.from
  for (const o of run.openings) {
    if (o.a > at) out.push({ a: at, b: o.a, y0: 0, y1: height })
    const top = o.kind === 'door' ? door.top : window.top
    if (o.kind === 'window') out.push({ a: o.a, b: o.b, y0: 0, y1: window.sill })
    if (top < height) out.push({ a: o.a, b: o.b, y0: top, y1: height })
    at = o.b
  }
  if (run.to > at) out.push({ a: at, b: run.to, y0: 0, y1: height })
  return out
}

/** Does a wall face the camera (it would hide the room)? Yaw in degrees, as the iso camera has it. */
export function facesCamera(run: WallRun, yawDeg: number): boolean {
  const y = (yawDeg * Math.PI) / 180
  return run.out[0] * Math.sin(y) + run.out[1] * Math.cos(y) > 0.01
}

/** How dark the floor is at (x, z) from the walls around (0 open … 1 right in a corner). */
export function floorShade(box: RoomBox, x: number, z: number, reach: number): number {
  const dx = Math.min(x - (box.x0 + 1), box.x0 + box.w - 1 - x)
  const dz = Math.min(z - (box.z0 + 1), box.z0 + box.d - 1 - z)
  const near = (v: number) => Math.max(0, 1 - Math.max(0, v) / reach)
  const a = near(dx)
  const b = near(dz)
  return Math.min(1, a + b - a * b * 0.5)
}

/** A color along the day: keys [hour, value] wrap around midnight; returns the blend weights. */
export function dayBlend(keys: ReadonlyArray<{ h: number }>, hour: number): { i: number; j: number; k: number } {
  const h = ((hour % 24) + 24) % 24
  let j = keys.findIndex((key) => key.h > h)
  if (j < 0) j = 0
  const i = (j - 1 + keys.length) % keys.length
  const span = (keys[j]!.h - keys[i]!.h + 24) % 24 || 24
  return { i, j, k: ((h - keys[i]!.h + 24) % 24) / span }
}
