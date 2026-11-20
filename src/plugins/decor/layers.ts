/**
 * What can share a cell (pure, tested in tests/house.test.ts):
 *   rug   — lies on the floor; one per cell; furniture can stand on it
 *   floor — furniture; one per cell (on a rug or not)
 *   top   — small things on a table (a floor piece with a `surface`); one per table
 *   wall  — hangs on a wall; one per wall cell
 */
export type Layer = 'floor' | 'rug' | 'top' | 'wall'

export interface Placed<T = unknown> {
  layer: Layer
  /** Height of the top a `top` piece can stand on (blocks; 0 = none). */
  surface: number
  /** Base height. */
  y: number
  ref: T
}

/** Can a piece of `layer` go into a cell with `here`? If it goes on a table, `on` is that table. */
export function fits<T>(layer: Layer, here: readonly Placed<T>[]): { ok: boolean; on?: Placed<T> } {
  const has = (l: Layer) => here.some((p) => p.layer === l)
  switch (layer) {
    case 'rug':
      return { ok: !has('rug') }
    case 'floor':
      return { ok: !has('floor') && !has('top') && !has('wall') }
    case 'wall':
      return { ok: !has('wall') }
    case 'top': {
      const table = here.find((p) => p.layer === 'floor' && p.surface > 0)
      return table && !has('top') ? { ok: true, on: table } : { ok: false }
    }
  }
}

/** Which placed piece the action key reaches first: what's on top of the stack. */
export function topmost<T>(here: readonly Placed<T>[]): Placed<T> | undefined {
  const order: Record<Layer, number> = { top: 3, wall: 2, floor: 1, rug: 0 }
  return [...here].sort((a, b) => order[b.layer] - order[a.layer])[0]
}
