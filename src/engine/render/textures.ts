import { z } from 'zod'

/** Size of one block texture in pixels (pixel-art look). */
export const TILE = 16

export const TextureSchema = z.looseObject({
  id: z.string(),
  tags: z.array(z.string()).optional(),
  /** Image URL (PNGs in content/<pack>/textures/ are registered automatically). */
  url: z.string().optional(),
  /** Procedural pattern name (see `api.textures.pattern`). */
  pattern: z.string().default('noise'),
  /** Palette for the pattern; meaning depends on the pattern. */
  colors: z.array(z.string()).default(['#ff00ff']),
  seed: z.number().default(1),
  params: z.record(z.string(), z.number()).default({}),
})
export type TextureDef = z.infer<typeof TextureSchema>

export interface PatternContext {
  /** Set one pixel (x, y in 0..TILE-1, y = 0 is the top row). */
  px(x: number, y: number, color: string | [number, number, number]): void
  rand(): number
  colors: string[]
  params: Record<string, number>
  size: number
  /** `color` with brightness multiplied by `k`. */
  shade(color: string, k: number): [number, number, number]
}

export type PatternFn = (ctx: PatternContext) => void

const hexToRgb = (c: string): [number, number, number] => {
  let h = c.replace('#', '')
  if (h.length === 3) h = [...h].map((ch) => ch + ch).join('')
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export const shade = (color: string, k: number): [number, number, number] => {
  const [r, g, b] = hexToRgb(color)
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)))
  return [c(r), c(g), c(b)]
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const col = (ctx: PatternContext, i: number) => ctx.colors[i] ?? ctx.colors[0] ?? '#ff00ff'

/** Built-in patterns. Plugins add more with `api.textures.pattern(name, fn)`. */
export const BUILTIN_PATTERNS: Record<string, PatternFn> = {
  flat(ctx) {
    for (let y = 0; y < ctx.size; y++) for (let x = 0; x < ctx.size; x++) ctx.px(x, y, col(ctx, 0))
  },
  /** colors[0] with random brightness; params.amount (default 0.12). */
  noise(ctx) {
    const amt = ctx.params.amount ?? 0.12
    for (let y = 0; y < ctx.size; y++) {
      for (let x = 0; x < ctx.size; x++) ctx.px(x, y, ctx.shade(col(ctx, 0), 1 - amt + ctx.rand() * amt * 2))
    }
  },
  /** noise of colors[0] with specks of colors[1..]; params.density (default 0.12). */
  speckle(ctx) {
    BUILTIN_PATTERNS.noise!(ctx)
    const density = ctx.params.density ?? 0.12
    for (let y = 0; y < ctx.size; y++) {
      for (let x = 0; x < ctx.size; x++) {
        if (ctx.rand() < density) {
          const c = col(ctx, 1 + Math.floor(ctx.rand() * Math.max(1, ctx.colors.length - 1)))
          ctx.px(x, y, ctx.shade(c, 0.9 + ctx.rand() * 0.2))
        }
      }
    }
  },
  /** colors[0] base with darker cracks; good for stone and cliffs. */
  stone(ctx) {
    BUILTIN_PATTERNS.noise!(ctx)
    const n = ctx.params.cracks ?? 5
    for (let k = 0; k < n; k++) {
      let x = Math.floor(ctx.rand() * ctx.size)
      let y = Math.floor(ctx.rand() * ctx.size)
      const len = 2 + Math.floor(ctx.rand() * 4)
      for (let s = 0; s < len; s++) {
        ctx.px(x, y, ctx.shade(col(ctx, 0), 0.72))
        x = (x + (ctx.rand() < 0.5 ? 1 : 0) + ctx.size) % ctx.size
        y = (y + (ctx.rand() < 0.5 ? 1 : -1) + ctx.size) % ctx.size
      }
    }
  },
  /** Horizontal planks: colors[0] wood; params.boards (default 4). */
  planks(ctx) {
    const boards = ctx.params.boards ?? 4
    const h = Math.max(1, Math.floor(ctx.size / boards))
    for (let y = 0; y < ctx.size; y++) {
      const row = Math.floor(y / h)
      const seam = y % h === h - 1
      const offset = (row * 7) % ctx.size
      for (let x = 0; x < ctx.size; x++) {
        const end = (x + offset) % ctx.size === 0
        const k = seam || end ? 0.7 : 0.92 + ctx.rand() * 0.14
        ctx.px(x, y, ctx.shade(col(ctx, 0), k))
      }
    }
  },
  /** Gentle ripples: colors[0] water, colors[1] highlight. */
  water(ctx) {
    BUILTIN_PATTERNS.noise!({ ...ctx, params: { amount: 0.05 } })
    for (let y = 0; y < ctx.size; y += 4) {
      const x0 = Math.floor(ctx.rand() * ctx.size)
      for (let s = 0; s < 4; s++) ctx.px((x0 + s) % ctx.size, (y + (s > 1 ? 1 : 0)) % ctx.size, col(ctx, 1))
    }
  },
}

/** Side of a grass block: colors[0] = soil, colors[1] = grass; params.depth (default 4). */
BUILTIN_PATTERNS.grass_side = (ctx) => {
  const soil = col(ctx, 0)
  const grass = col(ctx, 1)
  const depth = ctx.params.depth ?? 4
  for (let x = 0; x < ctx.size; x++) {
    const edge = depth + (ctx.rand() < 0.45 ? 1 : 0) + (ctx.rand() < 0.15 ? 1 : 0)
    for (let y = 0; y < ctx.size; y++) {
      const c = y < edge ? grass : soil
      ctx.px(x, y, ctx.shade(c, 0.88 + ctx.rand() * 0.24))
    }
  }
}

/** Magenta/black checker for unknown blocks and failed images. */
export const MISSING_PATTERN: PatternFn = (ctx) => {
  for (let y = 0; y < ctx.size; y++) {
    for (let x = 0; x < ctx.size; x++) ctx.px(x, y, ((x >> 2) + (y >> 2)) % 2 ? '#000000' : '#ff00ff')
  }
}
