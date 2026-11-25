/** The room inside the house: where the walls, the floor and the door are (pure, tested). */

export type CellKind = 'outside' | 'floor' | 'wall' | 'door'

export interface RoomPlan {
  /** First cell of the room inside the area. */
  x0: number
  z0: number
  w: number
  d: number
  /** The door: in the middle of the front wall (+z). */
  door: { x: number; z: number }
  /** Where you appear when coming in: just inside the door. */
  spawn: { x: number; z: number }
  kindAt(x: number, z: number): CellKind
  /** Which way a wall faces out (for camera-facing low walls): unit x/z, or 0 for corners' other axis. */
  outward(x: number, z: number): { x: number; z: number }
}

/** A w × d room (walls included) centered in an areaW × areaD area. */
export function planRoom(w: number, d: number, areaW = 16, areaD = 16): RoomPlan {
  const x0 = Math.floor((areaW - w) / 2)
  const z0 = Math.floor((areaD - d) / 2)
  const door = { x: x0 + Math.floor(w / 2), z: z0 + d - 1 }
  const inside = (x: number, z: number) => x >= x0 && x < x0 + w && z >= z0 && z < z0 + d
  return {
    x0,
    z0,
    w,
    d,
    door,
    spawn: { x: door.x + 0.5, z: door.z - 0.5 },
    kindAt(x, z) {
      if (!inside(x, z)) return 'outside'
      if (x === door.x && z === door.z) return 'door'
      return x === x0 || z === z0 || x === x0 + w - 1 || z === z0 + d - 1 ? 'wall' : 'floor'
    },
    outward(x, z) {
      return { x: x === x0 ? -1 : x === x0 + w - 1 ? 1 : 0, z: z === z0 ? -1 : z === z0 + d - 1 ? 1 : 0 }
    },
  }
}

/** Where something hanging on a wall of the old room hangs in the new one (area cells), or null. */
export function moveToWall(from: RoomPlan, to: RoomPlan, x: number, z: number): { x: number; z: number } | null {
  if (from.kindAt(x, z) !== 'wall') return null
  const out = from.outward(x, z)
  const at = { x: out.x < 0 ? to.x0 : out.x > 0 ? to.x0 + to.w - 1 : x, z: out.z < 0 ? to.z0 : out.z > 0 ? to.z0 + to.d - 1 : z }
  return to.kindAt(at.x, at.z) === 'wall' ? at : null
}

/** Is a wall on the side facing the camera (yaw in degrees)? Those are drawn low. */
export function nearWall(out: { x: number; z: number }, yawDeg: number): boolean {
  const y = (yawDeg * Math.PI) / 180
  return out.x * Math.sin(y) + out.z * Math.cos(y) > 0.01
}

/** Loan: how much a payment really takes (never more than owed or held). */
export function payment(want: number, debt: number, bells: number): number {
  return Math.max(0, Math.min(Math.round(want), debt, bells))
}
