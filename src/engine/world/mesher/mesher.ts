/**
 * Greedy voxel mesher with per-vertex ambient occlusion.
 * Pure function: runs in a Web Worker in the game and directly in tests.
 */

/** Block kinds in the render table. */
export const KIND_AIR = 0
export const KIND_OPAQUE = 1
export const KIND_TRANSPARENT = 2

/** How far a liquid surface sits below the top of its block (2 px of 16). */
export const LIQUID_INSET = 0.125

/** Face order used everywhere: +x, -x, +y, -y, +z, -z. */
export const FACES = ['east', 'west', 'top', 'bottom', 'south', 'north'] as const

export interface BlockTable {
  /** Indexed by block number. */
  kind: Uint8Array
  /** 6 faces × atlas rect (u, v, w, h) per block number. Block 0's rects = "missing" texture. */
  tiles: Float32Array
  /** 1 = liquid: its exposed surface is lowered by LIQUID_INSET. Optional. */
  liquid?: Uint8Array
  /** 1 = top faces get soft color patches (see MeshInput.tint). Optional. */
  tint?: Uint8Array
  /** Rounded island (roundMesher): color of a block's top and sides, rgb per block number. */
  topColor?: Float32Array
  sideColor?: Float32Array
  /** Rounded island: detail material slot of a block's top and sides (-1 = none). */
  detailTop?: Int16Array
  detailSide?: Int16Array
}

/** Large, soft color variation across tinted top faces (e.g. sunny and shady patches of lawn). */
export interface TintParams {
  /** World X/Z of the chunk's corner, so patches continue seamlessly across chunks. */
  origin: [number, number]
  seed: number
  /** Noise frequency (per block). */
  scale: number
  /** 0 = off, 1 = full colors. */
  strength: number
  /** Color multipliers (0..1+) blended by the noise. */
  a: [number, number, number]
  b: [number, number, number]
}

export interface MeshInput {
  /** Padded volume from `VoxelWorld.paddedVolume`: (sx+2) × (sy+2) × (sz+2). */
  vol: Uint16Array
  sx: number
  sy: number
  sz: number
  table: BlockTable
  /** Brightness for AO levels 0 (fully occluded) … 3 (open). */
  aoCurve: [number, number, number, number]
  /**
   * Longest merged quad side, in blocks (default: unlimited). Vertex-bending effects such as world
   * curvature need 1 so all vertices sit on the block grid and neighbouring quads never crack.
   */
  maxMerge?: number
  tint?: TintParams
}

export interface MeshBuffers {
  position: Float32Array
  normal: Float32Array
  /** In block units — the shader wraps them inside the atlas tile. */
  uv: Float32Array
  /** Atlas rect per vertex. */
  tile: Float32Array
  color: Float32Array
  /** Rounded island: detail material slot per vertex (-1 = none). */
  detail?: Float32Array
  index: Uint32Array
}

export interface MeshOutput {
  opaque: MeshBuffers
  transparent: MeshBuffers
}

class Builder {
  position: number[] = []
  normal: number[] = []
  uv: number[] = []
  tile: number[] = []
  color: number[] = []
  index: number[] = []
  vertexCount = 0

  finish(): MeshBuffers {
    return {
      position: new Float32Array(this.position),
      normal: new Float32Array(this.normal),
      uv: new Float32Array(this.uv),
      tile: new Float32Array(this.tile),
      color: new Float32Array(this.color),
      index: new Uint32Array(this.index),
    }
  }
}

export function meshChunk(input: MeshInput): MeshOutput {
  const { vol, sx, sy, sz, table, aoCurve } = input
  const maxMerge = Math.max(1, input.maxMerge ?? Infinity)
  const PX = sx + 2
  const PXZ = PX * (sz + 2)
  const dims = [sx, sy, sz]
  const kindLen = table.kind.length
  const liquid = table.liquid
  const isLiquid = (b: number) => !!liquid && b < liquid.length && liquid[b] === 1

  const at = (x: number, y: number, z: number) => vol[x + 1 + (z + 1) * PX + (y + 1) * PXZ]!
  const kindOf = (b: number) => (b === 0 ? KIND_AIR : b < kindLen ? table.kind[b]! : KIND_OPAQUE)
  const opaqueAt = (q: number[]) => (kindOf(at(q[0]!, q[1]!, q[2]!)) === KIND_OPAQUE ? 1 : 0)

  const builders = { opaque: new Builder(), transparent: new Builder() }
  const tint = input.tint && input.tint.strength > 0 && table.tint ? input.tint : undefined
  const tintable = (b: number) => !!tint && b < table.tint!.length && table.tint![b] === 1
  const q = [0, 0, 0]
  const nq = [0, 0, 0]
  const tmp = [0, 0, 0]
  const ao = [3, 3, 3, 3]

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3
    const v = (d + 2) % 3
    const U = dims[u]!
    const V = dims[v]!
    const mask = new Int32Array(U * V)

    for (const dir of [1, -1]) {
      const face = d * 2 + (dir > 0 ? 0 : 1)
      for (let slice = 0; slice < dims[d]!; slice++) {
        // Never draw the underside of the world.
        if (d === 1 && dir < 0 && slice === 0) continue

        // 1. Mask of visible faces in this slice: key = block << 8 | packed AO.
        for (let j = 0; j < V; j++) {
          for (let i = 0; i < U; i++) {
            q[d] = slice
            q[u] = i
            q[v] = j
            const b = at(q[0]!, q[1]!, q[2]!)
            const k = kindOf(b)
            let key = 0
            if (k !== KIND_AIR) {
              nq[0] = q[0]!
              nq[1] = q[1]!
              nq[2] = q[2]!
              nq[d] = nq[d]! + dir
              const n = at(nq[0]!, nq[1]!, nq[2]!)
              const kn = kindOf(n)
              const visible =
                kn === KIND_AIR || (k === KIND_OPAQUE && kn === KIND_TRANSPARENT) || (k === KIND_TRANSPARENT && kn === KIND_TRANSPARENT && n !== b)
              if (visible) {
                if (k === KIND_OPAQUE) {
                  // corners: (-,-) (+,-) (+,+) (-,+) along (u, v), sampled in the layer in front of the face
                  for (let c = 0; c < 4; c++) {
                    const a = c === 1 || c === 2 ? 1 : -1
                    const bb = c >= 2 ? 1 : -1
                    tmp[0] = nq[0]!
                    tmp[1] = nq[1]!
                    tmp[2] = nq[2]!
                    tmp[u] = tmp[u]! + a
                    const s1 = opaqueAt(tmp)
                    tmp[v] = tmp[v]! + bb
                    const corner = opaqueAt(tmp)
                    tmp[u] = tmp[u]! - a
                    const s2 = opaqueAt(tmp)
                    ao[c] = s1 && s2 ? 0 : 3 - (s1 + s2 + corner)
                  }
                  key = (b << 8) | ao[0]! | (ao[1]! << 2) | (ao[2]! << 4) | (ao[3]! << 6)
                } else {
                  // Liquids: mark faces of the topmost cell so their upper edge can be lowered.
                  const exposed = isLiquid(b) && at(q[0]!, q[1]! + 1, q[2]!) !== b
                  key = (b << 8) | (exposed ? 0xfe : 0xff)
                }
              }
            }
            mask[i + j * U] = key
          }
        }

        // 2. Greedy merge of equal keys into rectangles.
        for (let j = 0; j < V; j++) {
          for (let i = 0; i < U;) {
            const key = mask[i + j * U]!
            if (!key) {
              i++
              continue
            }
            let w = 1
            while (i + w < U && w < maxMerge && mask[i + w + j * U] === key) w++
            let h = 1
            outer: while (j + h < V && h < maxMerge) {
              for (let x = 0; x < w; x++) if (mask[i + x + (j + h) * U] !== key) break outer
              h++
            }
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[i + x + (j + y) * U] = 0

            const b = key >>> 8
            const kind = kindOf(b)
            const target = kind === KIND_TRANSPARENT ? builders.transparent : builders.opaque
            // The low byte is packed AO for opaque faces, and a "lowered surface" flag only for transparent ones.
            const low = kind === KIND_TRANSPARENT && (key & 0xff) === 0xfe
            const quadTint = d === 1 && dir > 0 && tintable(b) ? tint : undefined
            emitQuad(target, table, b, face, d, u, v, dir, slice, i, j, w, h, low ? 0xff : key & 0xff, aoCurve, low, quadTint)
            i += w
          }
        }
      }
    }
  }

  return { opaque: builders.opaque.finish(), transparent: builders.transparent.finish() }
}

function emitQuad(
  out: Builder,
  table: BlockTable,
  b: number,
  face: number,
  d: number,
  u: number,
  v: number,
  dir: number,
  slice: number,
  i: number,
  j: number,
  w: number,
  h: number,
  aoPacked: number,
  aoCurve: readonly number[],
  lowerTop = false,
  tint?: TintParams,
): void {
  const base = [0, 0, 0]
  base[d] = slice + (dir > 0 ? 1 : 0)
  base[u] = i
  base[v] = j
  const tileBase = (b * 6 + face) * 4
  const fallback = face * 4 // block 0 rects = missing texture
  const rect = tileBase + 3 < table.tiles.length ? tileBase : fallback
  const ao = [aoPacked & 3, (aoPacked >> 2) & 3, (aoPacked >> 4) & 3, (aoPacked >> 6) & 3]

  // corners p0..p3 at (u, v) offsets (0,0) (w,0) (w,h) (0,h)
  const offs = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ]
  const start = out.vertexCount
  // Top edge of the quad in world Y (for lowering liquid surfaces).
  const topY = d === 1 ? base[1]! : base[1]! + (u === 1 ? w : v === 1 ? h : 0)
  for (let c = 0; c < 4; c++) {
    const [ou, ov] = offs[c]!
    const p = [base[0]!, base[1]!, base[2]!]
    p[u] = p[u]! + ou!
    p[v] = p[v]! + ov!
    if (lowerTop && p[1] === topY && !(d === 1 && dir < 0)) p[1] = p[1]! - LIQUID_INSET
    out.position.push(p[0]!, p[1]!, p[2]!)
    const n = [0, 0, 0]
    n[d] = dir
    out.normal.push(n[0]!, n[1]!, n[2]!)
    // Texture V always follows world Y on side faces.
    if (d === 2) out.uv.push(ou!, ov!)
    else out.uv.push(ov!, ou!)
    out.tile.push(table.tiles[rect]!, table.tiles[rect + 1]!, table.tiles[rect + 2]!, table.tiles[rect + 3]!)
    const light = aoCurve[ao[c]!]!
    if (tint) {
      const [r, g, bb] = tintAt(tint, tint.origin[0] + p[0]!, tint.origin[1] + p[2]!)
      out.color.push(light * r, light * g, light * bb)
    } else out.color.push(light, light, light)
  }
  out.vertexCount += 4

  // Split along the diagonal that keeps AO gradients smooth.
  const tris = ao[0]! + ao[2]! > ao[1]! + ao[3]! ? [0, 1, 2, 0, 2, 3] : [0, 1, 3, 1, 2, 3]
  for (let t = 0; t < 6; t += 3) {
    if (dir > 0) out.index.push(start + tris[t]!, start + tris[t + 1]!, start + tris[t + 2]!)
    else out.index.push(start + tris[t]!, start + tris[t + 2]!, start + tris[t + 1]!)
  }
}

/** Color multiplier at world (x, z): two octaves of smooth value noise blending `a` and `b`. */
export function tintAt(t: TintParams, x: number, z: number): [number, number, number] {
  const n = 0.65 * valueNoise(x * t.scale, z * t.scale, t.seed) + 0.35 * valueNoise(x * t.scale * 2.7 + 31.7, z * t.scale * 2.7 - 12.3, t.seed + 1)
  const k = smooth(Math.min(1, Math.max(0, (n - 0.2) / 0.6)))
  const mix = (i: number) => 1 + (t.a[i]! + (t.b[i]! - t.a[i]!) * k - 1) * t.strength
  return [mix(0), mix(1), mix(2)]
}

const smooth = (f: number) => f * f * (3 - 2 * f)

function hash2(x: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(seed, 1442695041)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Smooth 2D value noise in [0, 1]. */
export function valueNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x)
  const z0 = Math.floor(z)
  const fx = smooth(x - x0)
  const fz = smooth(z - z0)
  const a = hash2(x0, z0, seed)
  const b = hash2(x0 + 1, z0, seed)
  const c = hash2(x0, z0 + 1, seed)
  const d = hash2(x0 + 1, z0 + 1, seed)
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz
}
