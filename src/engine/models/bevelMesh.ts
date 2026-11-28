/**
 * Soft-edged furniture from voxel models (pure, no three.js): the model is split into boxes (greedy,
 * per part), and each box is drawn with bevelled edges and corners — crisp shapes with soft edges,
 * at a few dozen triangles per box. Parts are groups of palette characters that belong together
 * (the light and the dark stripe of the same planks): they merge into one box and take the first
 * character's color.
 */
import { voxelAt, type GeometryData, type VoxelModel } from './voxelModel'

export interface Box {
  min: [number, number, number]
  /** Exclusive. */
  max: [number, number, number]
  /** Color index the box is painted with. */
  color: number
}

/**
 * Split a model into boxes: grow along x, then z, then y while every voxel belongs to the same part
 * and is still free. `partOf` maps a color index to its part (default: each color its own part).
 */
export function splitBoxes(m: VoxelModel, partOf: (color: number) => number = (c) => c): Box[] {
  const [sx, sy, sz] = m.size
  const used = new Uint8Array(sx * sy * sz)
  const at = (x: number, y: number, z: number) => x + z * sx + y * sx * sz
  const part = (x: number, y: number, z: number) => {
    const c = voxelAt(m, x, y, z)
    return c ? partOf(c) : 0
  }
  const free = (x: number, y: number, z: number, p: number) => !used[at(x, y, z)] && part(x, y, z) === p
  const boxes: Box[] = []
  for (let y = 0; y < sy; y++)
    for (let z = 0; z < sz; z++)
      for (let x = 0; x < sx; x++) {
        const p = part(x, y, z)
        if (!p || used[at(x, y, z)]) continue
        let x1 = x + 1
        while (x1 < sx && free(x1, y, z, p)) x1++
        let z1 = z + 1
        grow: while (z1 < sz) {
          for (let i = x; i < x1; i++) if (!free(i, y, z1, p)) break grow
          z1++
        }
        let y1 = y + 1
        grow: while (y1 < sy) {
          for (let k = z; k < z1; k++) for (let i = x; i < x1; i++) if (!free(i, y1, k, p)) break grow
          y1++
        }
        for (let j = y; j < y1; j++) for (let k = z; k < z1; k++) for (let i = x; i < x1; i++) used[at(i, j, k)] = 1
        boxes.push({ min: [x, y, z], max: [x1, y1, z1], color: voxelAt(m, x, y, z) })
      }
  return boxes
}

/**
 * Geometry of boxes with bevelled edges (`bevel` voxels, at most a third of the box's thinnest side),
 * positions relative to `pivot` (voxel units). Each box: 6 inset faces, 12 slanted edge strips and 8
 * corner triangles.
 */
export function buildBevelGeometry(boxes: readonly Box[], pivot: readonly [number, number, number], bevel: number): GeometryData {
  const out: GeometryData = { position: [], normal: [], colorIndex: [], index: [] }
  for (const b of boxes) addBevelBox(out, b, pivot, bevel)
  return out
}

function addBevelBox(out: GeometryData, b: Box, pivot: readonly [number, number, number], bevel: number): void {
  const lo = [b.min[0] - pivot[0], b.min[1] - pivot[1], b.min[2] - pivot[2]]
  const hi = [b.max[0] - pivot[0], b.max[1] - pivot[1], b.max[2] - pivot[2]]
  const r = Math.max(0, Math.min(bevel, (hi[0]! - lo[0]!) / 3, (hi[1]! - lo[1]!) / 3, (hi[2]! - lo[2]!) / 3))
  // a corner point of the box, pulled in by r along the axes in `inset`
  const p = (sx: number, sy: number, sz: number, inset: readonly [number, number, number]): [number, number, number] => [
    (sx > 0 ? hi[0]! : lo[0]!) - sx * r * inset[0],
    (sy > 0 ? hi[1]! : lo[1]!) - sy * r * inset[1],
    (sz > 0 ? hi[2]! : lo[2]!) - sz * r * inset[2],
  ]
  const tri = (a: number[], c: number[], d: number[], n: readonly number[]) => {
    const base = out.position.length / 3
    const len = Math.hypot(n[0]!, n[1]!, n[2]!) || 1
    for (const v of [a, c, d]) {
      out.position.push(v[0]!, v[1]!, v[2]!)
      out.normal.push(n[0]! / len, n[1]! / len, n[2]! / len)
      out.colorIndex.push(b.color)
    }
    // wind so the face looks along its normal
    const e1 = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!]
    const e2 = [d[0]! - a[0]!, d[1]! - a[1]!, d[2]! - a[2]!]
    const cx = e1[1]! * e2[2]! - e1[2]! * e2[1]!
    const cy = e1[2]! * e2[0]! - e1[0]! * e2[2]!
    const cz = e1[0]! * e2[1]! - e1[1]! * e2[0]!
    if (cx * n[0]! + cy * n[1]! + cz * n[2]! >= 0) out.index.push(base, base + 1, base + 2)
    else out.index.push(base, base + 2, base + 1)
  }
  const quad = (a: number[], c: number[], d: number[], e: number[], n: readonly number[]) => {
    tri(a, c, d, n)
    tri(a, d, e, n)
  }
  const S = [-1, 1] as const
  // faces: for each axis and side, the face inset by r on the other two axes
  for (let axis = 0; axis < 3; axis++)
    for (const s of S) {
      const n = [0, 0, 0]
      n[axis] = s
      const u = (axis + 1) % 3
      const v = (axis + 2) % 3
      const corner = (su: number, sv: number) => {
        const sgn = [0, 0, 0]
        sgn[axis] = s
        sgn[u] = su
        sgn[v] = sv
        const inset: [number, number, number] = [1, 1, 1]
        inset[axis] = 0
        return p(sgn[0]!, sgn[1]!, sgn[2]!, inset)
      }
      quad(corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1), n)
    }
  // edges: between two faces, a strip slanted at 45°
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3
    const v = (axis + 2) % 3
    for (const su of S)
      for (const sv of S) {
        const n = [0, 0, 0]
        n[u] = su
        n[v] = sv
        const pt = (sa: number, onU: boolean) => {
          const sgn = [0, 0, 0]
          sgn[axis] = sa
          sgn[u] = su
          sgn[v] = sv
          const inset: [number, number, number] = [0, 0, 0]
          inset[axis] = 1
          if (onU) inset[v] = 1
          else inset[u] = 1
          return p(sgn[0]!, sgn[1]!, sgn[2]!, inset)
        }
        quad(pt(-1, true), pt(1, true), pt(1, false), pt(-1, false), n)
      }
  }
  // corners: a triangle closing the three strips
  for (const sx of S) for (const sy of S) for (const sz of S) tri(p(sx, sy, sz, [0, 1, 1]), p(sx, sy, sz, [1, 0, 1]), p(sx, sy, sz, [1, 1, 0]), [sx, sy, sz])
}

/**
 * Which palette colors are drawn as one part: neighbouring shades (the light and the dark stripe of
 * the same planks) closer than `threshold` (sum of RGB differences, 0…765) merge into the first of
 * them; clearly different colors (a dark frame on light planks) stay apart. `same(a, b)` can forbid a
 * merge (different materials). Returns, per color index, the color index of its part.
 */
export function shadeParts(colors: readonly string[], threshold: number, same: (a: number, b: number) => boolean = () => true): number[] {
  const rgb = colors.map((c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) || 0))
  const out = colors.map((_, i) => i)
  for (let i = 1; i < colors.length; i++)
    for (let j = 1; j < i; j++) {
      if (out[j] !== j) continue
      const d = Math.abs(rgb[i]![0]! - rgb[j]![0]!) + Math.abs(rgb[i]![1]! - rgb[j]![1]!) + Math.abs(rgb[i]![2]! - rgb[j]![2]!)
      if (d < threshold && same(i, j)) {
        out[i] = j
        break
      }
    }
  return out
}
