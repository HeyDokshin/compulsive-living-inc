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
