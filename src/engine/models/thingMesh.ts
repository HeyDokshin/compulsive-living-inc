/**
 * How a thing is built from its voxel model (pure, no three.js): soft-edged boxes for angular things,
 * softly rounded for small round ones, plain voxel faces where asked. Shared by the model library
 * and the triangle budget test.
 */
import { buildBevelGeometry, shadeParts, splitBoxes } from './bevelMesh'
import { buildSmoothGeometry } from './smoothMesh'
import type { GeometryData, VoxelModel } from './voxelModel'

/** `render.models` in the engine config. */
export interface ModelBuild {
  style: 'auto' | 'blocks'
  bevel: number
  maxBoxes: number
  merge: number
}

export interface ThingDef {
  style: 'auto' | 'bevel'
  /** World units per voxel. */
  scale: number
  parts?: Record<string, string>
  palette: Record<string, string>
}

/** Soft-edged boxes (or softly rounded, see `ModelBuild.maxBoxes`), positions relative to `pivot`. */
export function buildThing(model: VoxelModel, pivot: [number, number, number], def: ThingDef, b: ModelBuild): GeometryData {
  const parts = partsOf(model, def, b.merge)
  const boxes = splitBoxes(model, (c) => parts[c]!)
  if (def.style === 'auto' && boxes.length > b.maxBoxes && isSmall(model, def.scale))
    return buildSmoothGeometry(model, pivot, { subdiv: 1, smooth: 1, iso: 0.42, keep: 0.62 })
  for (const box of boxes) box.color = parts[box.color]!
  return buildBevelGeometry(boxes, pivot, b.bevel)
}

/** A thing at most this many blocks across: a small one (a pot, a lamp), not a stall or a house. */
export const SMALL = 1.5

export function isSmall(model: VoxelModel, scale: number): boolean {
  return Math.max(...model.size) * scale <= SMALL
}

/**
 * Per color index, the color index of its piece: the model's `parts`, else neighbouring shades of the
 * same material merged (the light and dark stripes of planks become one board).
 */
export function partsOf(model: VoxelModel, def: Pick<ThingDef, 'parts' | 'palette'>, merge: number): number[] {
  const chars = Object.keys(def.palette)
  if (def.parts) {
    const out = model.colors.map((_, i) => i)
    for (const group of Object.values(def.parts)) {
      const first = chars.indexOf(group[0] ?? '') + 1
      if (first > 0) for (const ch of group) if (chars.indexOf(ch) >= 0) out[chars.indexOf(ch) + 1] = first
    }
    return out
  }
  const kind = model.colors.map((c) => surfaceFor(c))
  return shadeParts(model.colors, merge, (x, y) => kind[x] === kind[y])
}

/** The generated surface a painted color suggests (by hue, saturation and lightness). */
export function surfaceFor(hex: string): string {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (max !== min) {
    if (max === r) h = ((g - b) / (max - min) + 6) % 6
    else if (max === g) h = (b - r) / (max - min) + 2
    else h = (r - g) / (max - min) + 4
    h *= 60
  }
  if (l > 0.86) return 'core:plaster'
  if (s < 0.14) return 'core:stone'
  if (h >= 15 && h <= 48 && s < 0.75 && l < 0.72) return 'core:wood'
  if (h >= 70 && h <= 170) return 'core:leaves'
  return 'core:painted'
}

/** A flat thing (a rug, a picture, a wall clock) as one picture: its face seen straight on. */
export interface FlatPicture {
  /** 'y': lies flat (seen from above); 'z': hangs facing +z (seen from the front). */
  axis: 'y' | 'z'
  w: number
  h: number
  /** RGBA, row 0 at the top (the back edge of a rug, the top of a picture); see-through where empty. */
  rgba: Uint8ClampedArray
  /** The color index covering most of it (for its material). */
  main: number
}

/** Is the model a flat thing — one voxel thin, at least `min` across both other ways? */
export function flatAxis(model: VoxelModel, min = 6): 'y' | 'z' | null {
  const [sx, sy, sz] = model.size
  if (sy === 1 && sx >= min && sz >= min) return 'y'
  if (sz === 1 && sx >= min && sy >= min) return 'z'
  return null
}

/**
 * The picture of a flat thing in its own colors. Empty texels take the color of their filled
 * neighbours (alpha stays 0), so a smoothly scaled picture has no dark fringe round its outline.
 */
export function flatPicture(model: VoxelModel, axis: 'y' | 'z', colors: readonly string[]): FlatPicture {
  const [sx, sy, sz] = model.size
  const w = sx
  const h = axis === 'y' ? sz : sy
  const rgb = colors.map((c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) || 0))
  const rgba = new Uint8ClampedArray(w * h * 4)
  const count = new Map<number, number>()
  for (let row = 0; row < h; row++)
    for (let x = 0; x < w; x++) {
      // rugs: the top voxel of the column; pictures: the frontmost
      let ci = 0
      if (axis === 'y') for (let y = sy - 1; y >= 0 && !ci; y--) ci = voxelIndexColor(model, x, y, row)
      else for (let z = sz - 1; z >= 0 && !ci; z--) ci = voxelIndexColor(model, x, sy - 1 - row, z)
      if (!ci) continue
      const o = (row * w + x) * 4
      const c = rgb[ci]!
      rgba[o] = c[0]!
      rgba[o + 1] = c[1]!
      rgba[o + 2] = c[2]!
      rgba[o + 3] = 255
      count.set(ci, (count.get(ci) ?? 0) + 1)
    }
  // bleed colors into the empty texels around (two rings)
  for (let pass = 0; pass < 2; pass++) {
    const src = rgba.slice()
    for (let row = 0; row < h; row++)
      for (let x = 0; x < w; x++) {
        const o = (row * w + x) * 4
        if (src[o + 3]! || (src[o]! | src[o + 1]! | src[o + 2]!) !== 0) continue
        let n = 0
        const sum = [0, 0, 0]
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const xx = x + dx
          const yy = row + dy
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          const q = (yy * w + xx) * 4
          if (!src[q + 3]! && (src[q]! | src[q + 1]! | src[q + 2]!) === 0) continue
          sum[0]! += src[q]!
          sum[1]! += src[q + 1]!
          sum[2]! += src[q + 2]!
          n++
        }
        if (n) for (let k = 0; k < 3; k++) rgba[o + k] = Math.round(sum[k]! / n)
      }
  }
  const main = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1
  return { axis, w, h, rgba, main }
}

function voxelIndexColor(m: VoxelModel, x: number, y: number, z: number): number {
  return m.voxels[x + z * m.size[0] + y * m.size[0] * m.size[2]] ?? 0
}
