/** Grid A* for click-to-walk (pure). Cells are columns (x, z). */

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
