/** Voxel model data and pure geometry building (no three.js) — usable in tests and workers. */

export interface VoxelModel {
  size: [number, number, number]
  /** Color index per voxel (0 = empty). Index: x + z * sx + y * sx * sz. */
  voxels: Uint8Array
  /** Index → '#rrggbb'. Entry 0 unused. */
  colors: string[]
}

export function voxelIndex(m: VoxelModel, x: number, y: number, z: number): number {
  return x + z * m.size[0] + y * m.size[0] * m.size[2]
}

export function voxelAt(m: VoxelModel, x: number, y: number, z: number): number {
  const [sx, sy, sz] = m.size
  if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return 0
  return m.voxels[voxelIndex(m, x, y, z)]!
}

/** Parse the text-layer format (see ModelDefSchema). Unknown characters are reported. */
export function parseLayers(layers: string[][], palette: Record<string, string>): VoxelModel {
  const sy = layers.length
  const sz = Math.max(0, ...layers.map((l) => l.length))
  const sx = Math.max(0, ...layers.flatMap((l) => l.map((r) => r.length)))
  const chars = Object.keys(palette)
  const colors = ['#000000', ...chars.map((c) => palette[c]!)]
  const lookup = new Map(chars.map((c, i) => [c, i + 1]))
  const model: VoxelModel = { size: [sx, sy, sz], voxels: new Uint8Array(sx * sy * sz), colors }
  layers.forEach((layer, y) =>
    layer.forEach((row, z) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x]!
        if (ch === '.' || ch === ' ') continue
        const idx = lookup.get(ch)
        if (idx === undefined) throw new Error(`unknown palette character "${ch}" (layer ${y}, row ${z})`)
        model.voxels[voxelIndex(model, x, y, z)] = idx
      }
    }),
  )
  return model
}

/** Parse a MagicaVoxel .vox file (first model). Its Z-up axes become our Y-up. */
export function parseVox(buffer: ArrayBuffer): VoxelModel {
  const view = new DataView(buffer)
  const tag = (o: number) => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3))
  if (tag(0) !== 'VOX ') throw new Error('not a .vox file')
  let size: [number, number, number] | undefined
  let xyzi: Array<[number, number, number, number]> | undefined
  let rgba: string[] | undefined
  let o = 8
  const end = buffer.byteLength
  while (o + 12 <= end) {
    const id = tag(o)
    const content = view.getUint32(o + 4, true)
    const children = view.getUint32(o + 8, true)
    const c = o + 12
    if (id === 'MAIN') {
      o = c + content // descend into children
      continue
    }
    if (id === 'SIZE' && !size) size = [view.getUint32(c, true), view.getUint32(c + 4, true), view.getUint32(c + 8, true)]
    if (id === 'XYZI' && !xyzi) {
      const n = view.getUint32(c, true)
      xyzi = []
      for (let i = 0; i < n; i++) {
        const p = c + 4 + i * 4
        xyzi.push([view.getUint8(p), view.getUint8(p + 1), view.getUint8(p + 2), view.getUint8(p + 3)])
      }
    }
    if (id === 'RGBA') {
      rgba = ['#000000']
      // palette entry i (1-based color index) is stored at position i-1
      for (let i = 0; i < 255; i++) {
        const p = c + i * 4
        const hex = (v: number) => v.toString(16).padStart(2, '0')
        rgba.push(`#${hex(view.getUint8(p))}${hex(view.getUint8(p + 1))}${hex(view.getUint8(p + 2))}`)
      }
    }
    o = c + content + children
  }
  if (!size || !xyzi) throw new Error('.vox file has no model')
  // vox (x, y, z-up) → ours (x, y-up, z): x → x, z → y, y → z (flipped so front faces +z)
  const [vx, vy, vz] = size
  const model: VoxelModel = {
    size: [vx, vz, vy],
    voxels: new Uint8Array(vx * vy * vz),
    colors: rgba ?? Array.from({ length: 256 }, (_, i) => (i ? `#${(0x808080 + i * 0x010101).toString(16).slice(-6)}` : '#000000')),
  }
  for (const [x, y, z, ci] of xyzi) model.voxels[voxelIndex(model, x, z, vy - 1 - y)] = ci
  return model
}

export interface GeometryData {
  position: number[]
  normal: number[]
  /** Color index per vertex (resolved to RGB by the caller, so palettes can be swapped). */
  colorIndex: number[]
  index: number[]
}

/**
 * Face directions: the axis they point along, the two axes of the face plane (u × v = the axis),
 * and which side.
 */
const DIRS: ReadonlyArray<{ d: 0 | 1 | 2; u: 0 | 1 | 2; v: 0 | 1 | 2; s: 1 | -1 }> = [
  { d: 0, u: 1, v: 2, s: 1 },
  { d: 0, u: 1, v: 2, s: -1 },
  { d: 1, u: 2, v: 0, s: 1 },
  { d: 1, u: 2, v: 0, s: -1 },
  { d: 2, u: 0, v: 1, s: 1 },
  { d: 2, u: 0, v: 1, s: -1 },
]

/**
 * Visible faces of a model, positions in voxel units relative to `pivot`. Neighbouring faces of one
 * color become one quad, up to `maxMerge` voxels long (long quads would show the curved world's bend).
 */
export function buildVoxelGeometry(m: VoxelModel, pivot: [number, number, number], maxMerge = Infinity): GeometryData {
  const out: GeometryData = { position: [], normal: [], colorIndex: [], index: [] }
  const at = [0, 0, 0] as [number, number, number]
  for (const { d, u, v, s } of DIRS) {
    const nu = m.size[u]
    const nv = m.size[v]
    const mask = new Int32Array(nu * nv)
    for (let layer = 0; layer < m.size[d]; layer++) {
      for (let j = 0; j < nv; j++) {
        for (let i = 0; i < nu; i++) {
          at[d] = layer
          at[u] = i
          at[v] = j
          const c = voxelAt(m, at[0], at[1], at[2])
          at[d] = layer + s
          mask[i + j * nu] = c && !voxelAt(m, at[0], at[1], at[2]) ? c : 0
        }
      }
      for (let j = 0; j < nv; j++) {
        for (let i = 0; i < nu; ) {
          const c = mask[i + j * nu]!
          if (!c) {
            i++
            continue
          }
          let w = 1
          while (i + w < nu && w < maxMerge && mask[i + w + j * nu] === c) w++
          let h = 1
          grow: while (j + h < nv && h < maxMerge) {
            for (let k = 0; k < w; k++) if (mask[i + k + (j + h) * nu] !== c) break grow
            h++
          }
          for (let dj = 0; dj < h; dj++) mask.fill(0, i + (j + dj) * nu, i + w + (j + dj) * nu)
          quad(out, pivot, d, u, v, s, layer + (s > 0 ? 1 : 0), i, j, w, h, c)
          i += w
        }
      }
    }
  }
  return out
}

function quad(out: GeometryData, pivot: [number, number, number], d: number, u: number, v: number, s: number, layer: number, i: number, j: number, w: number, h: number, c: number): void {
  const base = out.position.length / 3
  for (let k = 0; k < 4; k++) {
    const p = [0, 0, 0]
    p[d] = layer
    p[u] = i + (k === 1 || k === 2 ? w : 0)
    p[v] = j + (k >= 2 ? h : 0)
    out.position.push(p[0]! - pivot[0], p[1]! - pivot[1], p[2]! - pivot[2])
    const n = [0, 0, 0]
    n[d] = s
    out.normal.push(n[0]!, n[1]!, n[2]!)
    out.colorIndex.push(c)
  }
  if (s > 0) out.index.push(base, base + 1, base + 2, base, base + 2, base + 3)
  else out.index.push(base, base + 2, base + 1, base, base + 3, base + 2)
}

export function defaultPivot(m: VoxelModel): [number, number, number] {
  return [m.size[0] / 2, 0, m.size[2] / 2]
}
