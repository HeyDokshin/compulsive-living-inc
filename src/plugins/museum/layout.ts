/** The museum hall plan: parse the text layout (pure, tested in tests/museum.test.ts). */

export interface Cell {
  x: number
  z: number
}

export interface HallPlan {
  width: number
  depth: number
  /** Exhibit slots in reading order, per kind. */
  slots: { fish: Cell[]; bug: Cell[]; fossil: Cell[] }
  /** Where the player appears (center of the S cells). */
  spawn: { x: number; z: number }
  doors: Cell[]
  desks: Cell[]
  /** Where the curator stands (center of the C cells), if anywhere. */
  curator: { x: number; z: number } | null
  /** Decorations standing on the floor: p = plant, L = lamp. */
  decor: Array<Cell & { kind: 'plant' | 'lamp' }>
  /** Cells you can't walk into (slots, decor, desk, walls). */
  blocked: Set<string>
  at(x: number, z: number): string
}

const SLOT: Record<string, keyof HallPlan['slots']> = { F: 'fish', B: 'bug', O: 'fossil' }
export const WALLS = '#w='
const SOLID = 'FBOpLRC' + WALLS

export function parseHall(rows: readonly string[]): HallPlan {
  const depth = rows.length
  const width = Math.max(0, ...rows.map((r) => r.length))
  if (!depth || rows.some((r) => r.length !== width)) throw new Error('museum layout: all rows must have the same length')
  const plan: HallPlan = {
    width,
    depth,
    slots: { fish: [], bug: [], fossil: [] },
    spawn: { x: width / 2, z: depth / 2 },
    doors: [],
    desks: [],
    curator: null,
    decor: [],
    blocked: new Set(),
    at: (x, z) => rows[z]?.[x] ?? ' ',
  }
  const spawn: Cell[] = []
  const curator: Cell[] = []
  rows.forEach((row, z) =>
    [...row].forEach((ch, x) => {
      const kind = SLOT[ch]
      if (kind) plan.slots[kind].push({ x, z })
      if (ch === 'S') spawn.push({ x, z })
      if (ch === 'D') plan.doors.push({ x, z })
      if (ch === 'R') plan.desks.push({ x, z })
      if (ch === 'C') curator.push({ x, z })
      if (ch === 'p' || ch === 'L') plan.decor.push({ x, z, kind: ch === 'p' ? 'plant' : 'lamp' })
      if (SOLID.includes(ch)) plan.blocked.add(`${x},${z}`)
    }),
  )
  if (spawn.length) plan.spawn = center(spawn)
  if (curator.length) plan.curator = center(curator)
  return plan
}

function center(cells: Cell[]): { x: number; z: number } {
  return {
    x: cells.reduce((s, c) => s + c.x + 0.5, 0) / cells.length,
    z: cells.reduce((s, c) => s + c.z + 0.5, 0) / cells.length,
  }
}

/** Floor block under a layout character (`floors['.']` is the default). */
export function floorBlock(ch: string, floors: Record<string, string>): string {
  return floors[ch] ?? floors['.'] ?? 'core:planks'
}
