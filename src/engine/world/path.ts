/** Grid A* over columns (x, z) — pure; plugins get it from '@sdk' (click-to-walk, villagers). */

export interface Cell {
  x: number
  z: number
}

export interface PathOptions {
  /** Can a walker step from `a` to the neighbouring column `b`? */
  canStep(a: Cell, b: Cell): boolean
  /** Goal test (e.g. "next to the clicked cell"). */
  isGoal(c: Cell): boolean
  /** Estimate towards the goal (octile distance to the clicked cell). */
  target: Cell
  maxNodes?: number
}

const DIRS: Array<[number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
]

/** Path from `start` (excluded) to the first goal cell (included), or null. Diagonals only past free corners. */
export function findPath(start: Cell, opts: PathOptions): Cell[] | null {
  const key = (c: Cell) => `${c.x},${c.z}`
  const h = (c: Cell) => {
    const dx = Math.abs(c.x - opts.target.x)
    const dz = Math.abs(c.z - opts.target.z)
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)
  }
  if (opts.isGoal(start)) return []
  const open: Array<{ c: Cell; f: number }> = [{ c: start, f: h(start) }]
  const g = new Map<string, number>([[key(start), 0]])
  const from = new Map<string, Cell>()
  const closed = new Set<string>()
  const max = opts.maxNodes ?? 6000
  while (open.length && closed.size < max) {
    let bi = 0
    for (let i = 1; i < open.length; i++) if (open[i]!.f < open[bi]!.f) bi = i
    const { c } = open.splice(bi, 1)[0]!
    const ck = key(c)
    if (closed.has(ck)) continue
    closed.add(ck)
    if (opts.isGoal(c)) {
      const path: Cell[] = [c]
      let cur = from.get(ck)
      while (cur && key(cur) !== key(start)) {
        path.unshift(cur)
        cur = from.get(key(cur))
      }
      return path
    }
    for (const [dx, dz, cost] of DIRS) {
      const n = { x: c.x + dx, z: c.z + dz }
      const nk = key(n)
      if (closed.has(nk) || !opts.canStep(c, n)) continue
      if (dx && dz && (!opts.canStep(c, { x: c.x + dx, z: c.z }) || !opts.canStep(c, { x: c.x, z: c.z + dz }))) continue
      const ng = g.get(ck)! + cost
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng)
        from.set(nk, c)
        open.push({ c: n, f: ng + h(n) })
      }
    }
  }
  return null
}

/** Sample spacing along a segment, in blocks (well under a cell, so no column is skipped). */
const LINE_STEP = 0.2
const from: Cell = { x: 0, z: 0 }
const to: Cell = { x: 0, z: 0 }
const corner: Cell = { x: 0, z: 0 }

/**
 * Can a walker of half width `radius` go straight from point (ax, az) to point (bx, bz)? Every
 * column the segment crosses — and the two parallel edges `radius` to either side — must be
 * steppable from the one before (diagonal moves only past free corners, as in `findPath`).
 * Used to cut the corners of a grid path, so click-to-walk goes in straight lines. Doesn't allocate.
 */
export function lineWalkable(ax: number, az: number, bx: number, bz: number, radius: number, canStep: (a: Cell, b: Cell) => boolean): boolean {
  const dx = bx - ax
  const dz = bz - az
  const len = Math.hypot(dx, dz)
  if (len < 1e-6) return true
  const nx = -dz / len
  const nz = dx / len
  const steps = Math.ceil(len / LINE_STEP)
  for (let side = -1; side <= 1; side++) {
    const ox = nx * radius * side
    const oz = nz * radius * side
    // every edge starts from the column the walker is in
    from.x = Math.floor(ax)
    from.z = Math.floor(az)
    for (let i = 1; i <= steps; i++) {
      const f = i / steps
      to.x = Math.floor(ax + dx * f + ox)
      to.z = Math.floor(az + dz * f + oz)
      if (to.x === from.x && to.z === from.z) continue
      if (to.x !== from.x && to.z !== from.z) {
        corner.x = to.x
        corner.z = from.z
        if (!canStep(from, corner) || !canStep(corner, to)) return false
        corner.x = from.x
        corner.z = to.z
        if (!canStep(from, corner) || !canStep(corner, to)) return false
      } else if (!canStep(from, to)) return false
      from.x = to.x
      from.z = to.z
    }
  }
  return true
}
