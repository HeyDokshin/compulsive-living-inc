/**
 * Pure procedural material renderer (no DOM, no three.js) — runs in a worker and in tests.
 *
 * Every pattern is periodic over the tile, so textures repeat without seams at any size. Octaves
 * finer than the texture can show fade out smoothly (band limiting): the same material rendered at
 * 32 px and at 512 px has the same overall look, the larger one simply carries more detail.
 */
import type { BlendMode, LayerDef, LayerKind, MaskDef, MaterialDef } from './schema'

// ---------- hashing and periodic noise ----------------------------------------------------------

/** Integer hash → [0, 1). */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const mod = (a: number, p: number) => ((a % p) + p) % p
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smoothstep = (a: number, b: number, v: number) => {
  if (b <= a) return v < a ? 0 : 1
  const t = clamp01((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** Value noise with lattice period (px, py): x in [0, px) wraps. Range [0, 1]. */
export function periodicNoise(x: number, y: number, px: number, py: number, seed: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = fade(x - x0)
  const fy = fade(y - y0)
  const ax = mod(x0, px)
  const bx = mod(x0 + 1, px)
  const ay = mod(y0, py)
  const by = mod(y0 + 1, py)
  const a = hash2(ax, ay, seed)
  const b = hash2(bx, ay, seed)
  const c = hash2(ax, by, seed)
  const d = hash2(bx, by, seed)
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

/**
 * Fractal noise over the tile (u, v in [0, 1)), `scale` features across it. Octaves whose features
 * would be smaller than ~3 texels of a `res`-sized texture fade out; amplitude is normalized over
 * all octaves, so dropping fine ones only quiets the surface, it never shifts its brightness.
 */
export function fbm(u: number, v: number, scale: number, octaves: number, roughness: number, seed: number, res: number, aspect = 1): number {
  const limit = res / 3
  let sum = 0
  let norm = 0
  let amp = 1
  let f = Math.max(1, Math.round(scale))
  for (let o = 0; o < octaves; o++) {
    const fy = Math.max(1, Math.round(f * aspect))
    const w = Math.max(f, fy) <= limit / 2 ? 1 : clamp01(2 - Math.max(f, fy) / (limit / 2))
    if (w > 0) sum += (periodicNoise(u * f, v * fy, f, fy, seed + o * 1013) - 0.5) * amp * w
    norm += amp
    amp *= roughness
    f *= 2
  }
  return 0.5 + sum / Math.max(1e-6, norm)
}

/** Distances to the nearest two jittered points of a periodic n×n cell grid, and the nearest cell's random id. */
const worley = { f1: 0, f2: 0, id: 0 }
function cellsAt(u: number, v: number, n: number, seed: number, jitter: number): typeof worley {
  const x = u * n
  const y = v * n
  const cx = Math.floor(x)
  const cy = Math.floor(y)
  let f1 = 9
  let f2 = 9
  let id = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const gx = cx + dx
      const gy = cy + dy
      const wx = mod(gx, n)
      const wy = mod(gy, n)
      const px = gx + 0.5 + (hash2(wx, wy, seed) - 0.5) * jitter
      const py = gy + 0.5 + (hash2(wx, wy, seed + 71) - 0.5) * jitter
      const d = Math.hypot(px - x, py - y)
      if (d < f1) {
        f2 = f1
        f1 = d
        id = hash2(wx, wy, seed + 151)
      } else if (d < f2) f2 = d
    }
  }
  worley.f1 = f1
  worley.f2 = f2
  worley.id = id
  return worley
}

// ---------- patterns ----------------------------------------------------------------------------

interface PatternArgs {
  kind: LayerKind
  scale: number
  octaves: number
  roughness: number
  seed: number
  params: Record<string, number>
}

/**
 * A motif value from a signed distance (`d` > 0 inside, in cell units): crisp but antialiased
 * edges about a texel wide; motifs too small for the texture fade to half (no shimmer).
 */
function motif(d: number, cells: number, res: number, soft: number): number {
  const texel = cells / res
  const v = smoothstep(-texel * 1.2, texel * 1.2, d / Math.max(soft, 1e-3))
  const f = fineness(cells, res)
  return 0.5 + (v - 0.5) * f
}

/** Five-pointed star, signed distance (negative inside), outer radius 1. */
function sdStar5(px: number, py: number): number {
  const k1x = 0.809016994375
  const k1y = -0.587785252292
  const k2x = -k1x
  const k2y = k1y
  let x = Math.abs(px)
  let y = py
  let d = 2 * Math.max(k1x * x + k1y * y, 0)
  x -= d * k1x
  y -= d * k1y
  d = 2 * Math.max(k2x * x + k2y * y, 0)
  x -= d * k2x
  y -= d * k2y
  x = Math.abs(x)
  y -= 1
  const rf = 0.45
  const bax = rf * -k1y - 0
  const bay = rf * k1x - 1
  const h = clamp01((x * bax + y * bay) / (bax * bax + bay * bay))
  return Math.hypot(x - bax * h, y - bay * h) * Math.sign(y * bax - x * bay)
}

/** Heart, signed distance (negative inside), roughly 1 tall from y 0 up. */
function sdHeart(px: number, py: number): number {
  const x = Math.abs(px)
  const y = py
  if (y + x > 1) return Math.hypot(x - 0.25, y - 0.75) - Math.SQRT2 / 4
  const a = Math.hypot(x, y - 1)
  const m = 0.5 * Math.max(x + y, 0)
  const b = Math.hypot(x - m, y - m)
  return Math.min(a, b) * Math.sign(x - y)
}

/** 1 while `features` across the tile get ≥ 6 texels each in a `res` texture, fading to 0 by 3. */
function fineness(features: number, res: number): number {
  return clamp01((res / features - 3) / 3)
}

/** Pattern value in [0, 1] at tile coordinates (u, v); v grows downwards (texture rows). */
export function pattern(a: PatternArgs, u0: number, v0: number, res: number): number {
  const p = a.params
  // `across: 1` turns any pattern a quarter (boards standing up, upright stripes)
  const u = p.across ? v0 : u0
  const v = p.across ? u0 : v0
  const n = Math.max(1, Math.round(a.scale))
  switch (a.kind) {
    case 'fill':
      return 1
    case 'noise':
      return fbm(u, v, n, a.octaves, a.roughness, a.seed, res)
    case 'ridged':
      return 1 - Math.abs(fbm(u, v, n, a.octaves, a.roughness, a.seed, res) * 2 - 1)
    case 'cells': {
      // stones or tiles: each cell its own value, darker towards the seams
      const c = cellsAt(u, v, n, a.seed, p.jitter ?? 0.9)
      const edge = smoothstep(0, p.edge ?? 0.12, c.f2 - c.f1)
      return clamp01(c.id * (1 - (p.seams ?? 0.6)) + edge * (p.seams ?? 0.6))
    }
    case 'cracks': {
      // thin dark lines where cells meet (0 in the crack)
      const c = cellsAt(u, v, n, a.seed, p.jitter ?? 1)
      return smoothstep(0, (p.width ?? 0.04) * n * 0.25 + 0.02, c.f2 - c.f1)
    }
    case 'pebbles': {
      const c = cellsAt(u, v, n, a.seed, p.jitter ?? 0.8)
      // round domes, each its own shade
      const r = (p.size ?? 0.38) * (0.7 + 0.6 * c.id)
      const q = c.f1 / r
      const dome = q < 1 ? Math.sqrt(1 - q * q) : 0
      return Math.min(1, dome * 2.5) * (0.45 + 0.55 * c.id)
    }
    case 'strata': {
      // horizontal layers of rock, wavy, each band its own shade
      const bands = Math.max(1, Math.round(p.bands ?? n))
      const wob = (fbm(u, v, Math.max(1, Math.round(p.waves ?? 2)), 3, 0.5, a.seed + 5, res) - 0.5) * (p.wobble ?? 0.6)
      const y = v * bands + wob
      const band = Math.floor(y)
      const shade = hash2(mod(band, bands), 0, a.seed)
      const edge = smoothstep(0, p.soft ?? 0.15, y - band) * smoothstep(0, p.soft ?? 0.15, band + 1 - y)
      const fine = fbm(u, v, n * 2, a.octaves, a.roughness, a.seed + 9, res)
      return clamp01(shade * 0.65 + fine * 0.35) * (0.75 + 0.25 * edge)
    }
    case 'wood': {
      // grain along u: rings bent by noise
      const rings = p.rings ?? 6
      const bend = (fbm(u, v, n, a.octaves, a.roughness, a.seed, res, p.aspect ?? 4) - 0.5) * (p.wobble ?? 2)
      const t = v * rings + bend
      const ring = t - Math.floor(t)
      return clamp01(Math.pow(ring, p.sharp ?? 2.5) * 0.7 + fbm(u, v, n * 4, 3, 0.5, a.seed + 3, res, 8) * 0.3)
    }
    case 'boards': {
      // planks in rows (across v), staggered ends, a gap between
      const rows = Math.max(1, Math.round(p.rows ?? 4))
      const y = v * rows
      const row = Math.floor(y)
      // never thinner than a texel and a bit, or small textures lose the seams between boards
      const gap = Math.max(p.gap ?? 0.06, (1.2 * rows) / res)
      const lengths = Math.max(1, Math.round(p.lengths ?? 1))
      const x = u * lengths + hash2(mod(row, rows), 1, a.seed) * (p.stagger ?? 1)
      const board = Math.floor(x)
      const inGap = Math.min(y - row, row + 1 - y) < gap / 2 || (lengths > 1 && Math.min(x - board, board + 1 - x) < gap / (2 * lengths))
      if (inGap) return 0
      const id = hash2(mod(board, lengths), mod(row, rows), a.seed + 31)
      const grain = fbm(u, v, n, a.octaves, a.roughness, a.seed + row * 17, res, 0.25)
      return clamp01(0.25 + 0.75 * (id * 0.55 + grain * 0.45))
    }
    case 'grain': {
      // fine single-octave noise: sand, dust — `scale` grains across, but never finer than the texture
      const k = Math.min(n, Math.max(1, Math.floor(res / 2)))
      // fewer grains than asked: their contrast fades, so the average look stays the same
      return 0.5 + (periodicNoise(u * k, v * k, k, k, a.seed) - 0.5) * Math.min(1, (k / n) * 2)
    }
    case 'fibers':
      // threads: noise stretched along u
      return fbm(u, v, n, a.octaves, a.roughness, a.seed, res, p.stretch ?? 6)
    case 'twill': {
      // diagonal ribs of a twill weave (denim): n threads across, each a soft rounded ridge
      const t = (u + v) * n + (fbm(u, v, Math.max(1, Math.round(n / 4)), 2, 0.5, a.seed, res) - 0.5) * (p.wobble ?? 0.6)
      // too many ribs for the texture: they fade to grey instead of turning into moiré
      const rib = 0.5 + 0.5 * Math.cos((t - Math.floor(t)) * Math.PI * 2) * fineness(n * 1.5, res)
      const yarn = fbm(u, v, n * 2, 2, 0.5, a.seed + 7, res, p.stretch ?? 0.25)
      return clamp01(rib * 0.75 + yarn * 0.25)
    }
    case 'weave': {
      // plain weave: threads over and under in a checker, each bulging in the middle
      const x = u * n
      const y = v * n
      const over = (Math.floor(x) + Math.floor(y)) % 2 === 0
      const along = over ? y - Math.floor(y) : x - Math.floor(x)
      const across = over ? x - Math.floor(x) : y - Math.floor(y)
      const bulge = 0.5 + (Math.sin(across * Math.PI) * (0.75 + 0.25 * Math.sin(along * Math.PI)) - 0.5) * fineness(n * 2, res)
      const slub = fbm(u, v, n, 2, 0.5, a.seed + (over ? 1 : 2), res, over ? 0.25 : 4)
      return clamp01(bulge * 0.8 + slub * 0.2)
    }
    case 'stripes': {
      // straight bands: level (turns 0) or at an angle (whole turns per tile, so they tile)
      const turns = Math.max(0, Math.round(p.turns ?? 0))
      const t = (u * turns + v) * n
      const band = 0.5 + 0.5 * Math.cos((t - Math.floor(t)) * Math.PI * 2)
      return motif(band - (1 - (p.width ?? 0.5)), n * Math.max(1, turns), res, 0.25)
    }
    case 'waves': {
      const t = v * n + Math.sin(u * Math.PI * 2 * Math.max(1, Math.round(p.waves ?? 2))) * (p.amp ?? 0.35)
      const band = 0.5 + 0.5 * Math.cos((t - Math.floor(t)) * Math.PI * 2)
      return motif(band - (1 - (p.width ?? 0.45)), n * 2, res, 0.2)
    }
    case 'zigzag': {
      const x = u * Math.max(1, Math.round(p.teeth ?? n))
      const t = v * n + Math.abs(x - Math.floor(x) - 0.5) * (p.amp ?? 1)
      const band = 0.5 + 0.5 * Math.cos((t - Math.floor(t)) * Math.PI * 2)
      return motif(band - (1 - (p.width ?? 0.45)), n * 2, res, 0.2)
    }
    case 'checker': {
      const x = u * n
      const y = v * n
      const dx = Math.abs(x - Math.round(x))
      const dy = Math.abs(y - Math.round(y))
      const edge = Math.min(dx, dy) // distance to the nearest grid line (cells)
      const on = (Math.floor(x) + Math.floor(y)) % 2 === 0 ? 1 : -1
      return 0.5 + 0.5 * on * Math.min(1, edge / ((1.5 * n) / res + 1e-6)) * fineness(n * 2, res)
    }
    case 'dots':
    case 'stars':
    case 'hearts':
    case 'flowers': {
      // a motif per cell, rows staggered; each motif turned and sized a little differently
      const rows = n
      const y = v * rows
      const row = Math.floor(y)
      const x = u * n + (row % 2 === 1 ? (p.stagger ?? 0.5) : 0)
      const col = Math.floor(x)
      const id = hash2(mod(col, n), mod(row, rows), a.seed)
      let lx = x - col - 0.5
      let ly = y - row - 0.5
      const tilt = ((p.tilt ?? 0.4) * (id - 0.5) * Math.PI) / 2
      const c = Math.cos(tilt)
      const s = Math.sin(tilt)
      ;[lx, ly] = [lx * c - ly * s, lx * s + ly * c]
      const size = (p.size ?? 0.32) * (1 + ((p.vary ?? 0.25) * (id - 0.5)))
      let d: number
      if (a.kind === 'dots') d = Math.hypot(lx, ly) - size
      else if (a.kind === 'stars') d = sdStar5(lx / size, -ly / size) * size
      else if (a.kind === 'hearts') d = sdHeart(lx / (size * 1.6), -ly / (size * 1.6) + 0.5) * size * 1.6
      else {
        const r = Math.hypot(lx, ly)
        const th = Math.atan2(ly, lx)
        d = r - size * (0.55 + 0.45 * Math.abs(Math.cos(th * 2.5)))
      }
      return motif(-d, n, res, 1)
    }
    case 'marble': {
      const w = fbm(u, v, Math.max(1, Math.round(p.swirl ?? 3)), a.octaves, a.roughness, a.seed, res) * (p.warp ?? 4)
      const t = (u + v * 0.5) * n + w
      const vein = Math.abs(Math.sin(t * Math.PI))
      return clamp01(1 - Math.pow(vein, p.sharp ?? 0.18))
    }
    case 'terrazzo': {
      // chips of stone set in a matrix: each chip its own shade
      const c = cellsAt(u, v, n, a.seed, 1)
      const size = (p.size ?? 0.26) * (0.6 + 0.6 * c.id)
      const inside = 1 - smoothstep(size * 0.85, size, c.f1)
      return inside * (0.25 + 0.75 * c.id)
    }
    case 'scales': {
      // overlapping rounded scales, row over row
      // each scale is a disc hanging from its row's top; the row below lies over it
      const y = v * n
      const row = Math.floor(y)
      let r = 1
      for (const k of [row + 1, row]) {
        const x = u * n + (mod(k, 2) ? 0.5 : 0)
        const d = Math.hypot(x - Math.floor(x) - 0.5, y - k) / 1.5
        if (d < 0.5) {
          r = d
          break
        }
      }
      const rim = smoothstep(0.38, 0.5, r) * (1 - smoothstep(0.5, 0.56, r))
      return clamp01(0.55 * (1 - Math.min(1, r)) + rim * 0.9) * fineness(n * 2, res) + (1 - fineness(n * 2, res)) * 0.5
    }
    case 'herringbone': {
      // short boards slanting one way in odd columns, the other in even ones
      const cols = n
      const x = u * cols
      const col = Math.floor(x)
      const dir = col % 2 === 0 ? 1 : -1
      const t = v * cols * 2 + (x - col) * dir * 2
      const plank = t - Math.floor(t)
      const gap = Math.min(plank, 1 - plank)
      const id = hash2(mod(col, cols), mod(Math.floor(t), cols * 4), a.seed)
      const edge = smoothstep(0, (1.5 * cols * 2) / res + 0.03, gap)
      return clamp01((0.35 + 0.65 * id) * edge)
    }
    case 'knit': {
      // rows of V stitches: two slanted loops per cell
      const cols = n
      const rows = Math.max(1, Math.round(n * (p.rowsPerCol ?? 1.3)))
      const x = u * cols
      const y = v * rows
      const lx = x - Math.floor(x) - 0.5
      const ly = y - Math.floor(y)
      const side = lx < 0 ? -1 : 1
      const along = ly - Math.abs(lx) * 1.1
      const loop = 0.5 + (0.5 - smoothstep(0.18, 0.5, Math.hypot(Math.abs(lx) - 0.25, along - 0.35) * 1.6)) * fineness(rows * 2, res)
      const fuzz = fbm(u, v, cols * 4, 2, 0.5, a.seed + (side > 0 ? 1 : 2), res)
      return clamp01(loop * 0.85 + fuzz * 0.15)
    }
  }
  return 0
}

// ---------- colors and blending -----------------------------------------------------------------

/** '#rrggbb' → [r, g, b] in 0…1. */
export function parseHex(c: string): [number, number, number] {
  let h = c.trim().replace('#', '')
  if (h.length === 3) h = h.replace(/./g, (x) => x + x)
  const n = parseInt(h.slice(0, 6), 16)
  if (!Number.isFinite(n)) return [1, 0, 1]
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function blendChannel(mode: BlendMode, b: number, s: number): number {
  switch (mode) {
    case 'normal':
      return s
    case 'multiply':
      return b * s
    case 'screen':
      return 1 - (1 - b) * (1 - s)
    case 'overlay':
      return b < 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)
    case 'soft':
      return (1 - 2 * s) * b * b + 2 * s * b
    case 'add':
      return Math.min(1, b + s)
    case 'darken':
      return Math.min(b, s)
    case 'lighten':
      return Math.max(b, s)
  }
}

interface PreparedLayer {
  def: LayerDef
  ramp: Array<[number, number, number]>
  mask?: MaskDef
}

// ---------- the renderer ------------------------------------------------------------------------

/**
 * Render a material into `size`×`size` RGBA pixels (row 0 = top). Seamless when tiled.
 * `out` is reused when given and large enough.
 */
export function renderMaterial(def: MaterialDef, size: number, out?: Uint8ClampedArray): Uint8ClampedArray {
  const n = size * size
  const pixels = out && out.length >= n * 4 ? out : new Uint8ClampedArray(n * 4)
  const layers: PreparedLayer[] = def.layers.map((l) => ({ def: l, ramp: l.colors.map(parseHex), mask: l.mask }))
  const r = new Float32Array(n)
  const g = new Float32Array(n)
  const b = new Float32Array(n)
  const height = new Float32Array(n)
  const inv = 1 / size

  for (const L of layers) {
    const l = L.def
    const ramp = L.ramp
    const stops = ramp.length - 1
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let u = (x + 0.5) * inv
        let v = (y + 0.5) * inv
        if (l.warp > 0) {
          const wu = fbm(u, v, 2, 3, 0.5, l.seed + 11, size) - 0.5
          const wv = fbm(u, v, 2, 3, 0.5, l.seed + 23, size) - 0.5
          u = u + wu * l.warp + 1
          v = v + wv * l.warp + 1
          u -= Math.floor(u)
          v -= Math.floor(v)
        }
        let val = clamp01(pattern(l, u, v, size))
        if (l.contrast !== 1) val = Math.pow(val, l.contrast)
        let alpha = l.opacity
        const m = L.mask
        if (m) {
          let mv = pattern(m, u, v, size)
          mv = smoothstep(m.threshold - m.softness, m.threshold + m.softness, mv)
          alpha *= m.invert ? 1 - mv : mv
        }
        if (alpha <= 0) continue
        // ramp lookup
        let cr: number
        let cg: number
        let cb: number
        if (stops === 0) {
          ;[cr, cg, cb] = ramp[0]!
        } else {
          const t = val * stops
          const i = Math.min(stops - 1, Math.floor(t))
          const f = t - i
          const c0 = ramp[i]!
          const c1 = ramp[i + 1]!
          cr = c0[0] + (c1[0] - c0[0]) * f
          cg = c0[1] + (c1[1] - c0[1]) * f
          cb = c0[2] + (c1[2] - c0[2]) * f
        }
        const k = y * size + x
        r[k] = r[k]! + (blendChannel(l.blend, r[k]!, cr) - r[k]!) * alpha
        g[k] = g[k]! + (blendChannel(l.blend, g[k]!, cg) - g[k]!) * alpha
        b[k] = b[k]! + (blendChannel(l.blend, b[k]!, cb) - b[k]!) * alpha
        if (l.relief) height[k] = height[k]! + l.relief * (val - 0.5) * alpha
      }
    }
  }

  // Bake light and shade from the relief: light from the top left, soft occlusion in the grooves.
  const shading = def.shading
  const occl = def.occlusion
  const lx = -0.45
  const ly = -0.55
  const lz = 0.7
  const ll = Math.hypot(lx, ly, lz)
  const flat = lz / ll
  const reach = Math.max(1, Math.round(size / 24))
  const slope = size / 24 // height units per tile → per texel, independent of resolution
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = y * size + x
      let shade = 1
      if (shading > 0 || occl > 0) {
        const xl = y * size + mod(x - 1, size)
        const xr = y * size + mod(x + 1, size)
        const yu = mod(y - 1, size) * size + x
        const yd = mod(y + 1, size) * size + x
        const dx = (height[xr]! - height[xl]!) * slope * 0.5
        const dy = (height[yd]! - height[yu]!) * slope * 0.5
        const nl = Math.hypot(dx, dy, 1)
        const lit = (-dx * lx - dy * ly + lz) / (nl * ll)
        shade = 1 + (lit / flat - 1) * shading
        if (occl > 0) {
          const around =
            (height[y * size + mod(x - reach, size)]! +
              height[y * size + mod(x + reach, size)]! +
              height[mod(y - reach, size) * size + x]! +
              height[mod(y + reach, size) * size + x]!) /
            4
          shade *= 1 - clamp01((around - height[k]!) * occl)
        }
      }
      const o = k * 4
      pixels[o] = Math.round(clamp01(r[k]! * shade) * 255)
      pixels[o + 1] = Math.round(clamp01(g[k]! * shade) * 255)
      pixels[o + 2] = Math.round(clamp01(b[k]! * shade) * 255)
      pixels[o + 3] = 255
    }
  }
  return pixels
}
