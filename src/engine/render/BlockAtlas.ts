import { CanvasTexture, NearestFilter, SRGBColorSpace } from 'three'
import type { BlockDef } from '../types'
import type { BlockPalette } from '../world/BlockPalette'
import { KIND_AIR, KIND_OPAQUE, KIND_TRANSPARENT, type BlockTable } from '../world/mesher/mesher'
import {
  BUILTIN_PATTERNS,
  MISSING_PATTERN,
  TILE,
  mulberry32,
  shade,
  type PatternContext,
  type PatternFn,
  type TextureDef,
} from './textures'
import { createLogger } from '../util/log'

const log = createLogger('atlas')

/** Which texture each of the 6 faces uses: +x, -x, +y, -y, +z, -z. */
export function faceTextures(block: BlockDef): string[] {
  const t = (block.textures ?? {}) as Record<string, string | undefined>
  const auto = `auto:${block.id}`
  const side = t.side ?? t.all ?? auto
  return [
    t.east ?? side,
    t.west ?? side,
    t.top ?? t.all ?? auto,
    t.bottom ?? t.all ?? auto,
    t.south ?? side,
    t.north ?? side,
  ]
}

export interface AtlasPlan {
  /** Tile index → texture id. Index 0 is always the "missing" texture. */
  tiles: string[]
  cols: number
  /** Atlas size in pixels (square, power of two). */
  size: number
}

export function planAtlas(blocks: BlockDef[]): AtlasPlan {
  const tiles = ['missing']
  const seen = new Set(tiles)
  for (const b of blocks) {
    for (const id of faceTextures(b)) {
      if (!seen.has(id)) {
        seen.add(id)
        tiles.push(id)
      }
    }
  }
  const cols = Math.ceil(Math.sqrt(tiles.length))
  let size = 1
  while (size < cols * TILE) size *= 2
  return { tiles, cols: Math.floor(size / TILE), size }
}

/** UV rect (u, v, w, h) of a tile; v is bottom-up because the canvas texture is flipped. */
export function tileRect(plan: AtlasPlan, index: number): [number, number, number, number] {
  const col = index % plan.cols
  const row = Math.floor(index / plan.cols)
  const t = TILE / plan.size
  return [col * t, 1 - (row + 1) * t, t, t]
}

/** Render table for the mesher: kind + 6 tile rects per block number in the palette. */
export function buildBlockTable(plan: AtlasPlan, blocks: BlockDef[], palette: BlockPalette): BlockTable {
  for (const b of blocks) palette.num(b.id) // every registered block gets a number
  const n = palette.size
  const kind = new Uint8Array(n)
  const liquid = new Uint8Array(n)
  const tint = new Uint8Array(n)
  const tiles = new Float32Array(n * 24)
  const index = new Map(plan.tiles.map((id, i) => [id, i]))
  const missing = tileRect(plan, 0)
  for (let f = 0; f < 6; f++) tiles.set(missing, f * 4) // block 0 slot = fallback for unknown numbers
  const byId = new Map(blocks.map((b) => [b.id, b]))
  for (let num = 1; num < n; num++) {
    const b = byId.get(palette.id(num))
    kind[num] = b?.invisible ? KIND_AIR : b?.transparent ? KIND_TRANSPARENT : KIND_OPAQUE
    liquid[num] = b?.liquid && b.transparent ? 1 : 0
    tint[num] = b?.tint ? 1 : 0
    const faces = b ? faceTextures(b) : []
    for (let f = 0; f < 6; f++) {
      const ti = b ? (index.get(faces[f]!) ?? 0) : 0
      tiles.set(ti ? tileRect(plan, ti) : missing, (num * 6 + f) * 4)
    }
  }
  return { kind, tiles, liquid, tint }
}

/**
 * Block texture atlas built from the `textures` and `blocks` registries.
 * Procedural textures are drawn at build time; image textures are loaded once and cached.
 */
export class BlockAtlas {
  readonly canvas: HTMLCanvasElement
  readonly texture: CanvasTexture
  plan: AtlasPlan = { tiles: ['missing'], cols: 1, size: TILE }
  table: BlockTable = { kind: new Uint8Array(1), tiles: new Float32Array(24) }
  readonly patterns = new Map<string, PatternFn>(Object.entries(BUILTIN_PATTERNS))
  private images = new Map<string, Promise<HTMLImageElement | null>>()
  private building = 0
  private textureDefs: (id: string) => TextureDef | undefined = () => undefined
  /** Materials the rounded island shows close up, by detail slot (see roundColors). */
  detail: DetailPlan = { materials: [], variants: new Float32Array(MAX_DETAIL_SLOTS * 2), looks: new Float32Array(MAX_DETAIL_SLOTS * 4) }

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.width = this.canvas.height = TILE
    this.texture = new CanvasTexture(this.canvas)
    this.texture.magFilter = NearestFilter
    this.texture.minFilter = NearestFilter
    this.texture.generateMipmaps = false
    this.texture.colorSpace = SRGBColorSpace
  }

  /** Rebuild from registries. Resolves false if a newer rebuild started meanwhile. */
  async rebuild(blocks: BlockDef[], textures: (id: string) => TextureDef | undefined, palette: BlockPalette): Promise<boolean> {
    const token = ++this.building
    this.textureDefs = textures
    const plan = planAtlas(blocks)
    const urls = plan.tiles.map((id) => textures(id)?.url)
    const images = await Promise.all(urls.map((u) => (u ? this.loadImage(u) : Promise.resolve(null))))
    if (token !== this.building) return false

    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = plan.size
    const g = canvas.getContext('2d')!
    const blockById = new Map(blocks.map((b) => [b.id, b]))

    plan.tiles.forEach((id, i) => {
      const x0 = (i % plan.cols) * TILE
      const y0 = Math.floor(i / plan.cols) * TILE
      const img = images[i]
      if (img) {
        g.imageSmoothingEnabled = false
        g.drawImage(img, x0, y0, TILE, TILE)
        return
      }
      let def: Pick<TextureDef, 'pattern' | 'colors' | 'seed' | 'params'> | undefined = textures(id)
      if (!def && id.startsWith('auto:')) {
        const b = blockById.get(id.slice(5))
        def = { pattern: 'noise', colors: [b?.color ?? '#ff00ff'], seed: hash(id), params: {} }
      }
      if (!def && id !== 'missing') log.warn(`unknown texture "${id}" (shown as missing)`)
      const fn = id === 'missing' || !def ? MISSING_PATTERN : this.patterns.get(def.pattern)
      if (!fn && def) log.warn(`texture "${id}": unknown pattern "${def.pattern}"`)
      drawPattern(g, x0, y0, fn ?? MISSING_PATTERN, def ?? { colors: [], seed: 1, params: {}, pattern: '' })
    })

    this.canvas.width = this.canvas.height = plan.size
    this.canvas.getContext('2d')!.drawImage(canvas, 0, 0)
    this.texture.dispose() // size may change: let three re-upload a fresh GPU texture
    this.texture.needsUpdate = true
    this.plan = plan
    this.table = buildBlockTable(plan, blocks, palette)
    this.detail = roundColors(this.table, blocks, palette, textures)
    return true
  }

  /** Recompute the table only (palette grew, textures unchanged). */
  refreshTable(blocks: BlockDef[], palette: BlockPalette): void {
    this.table = buildBlockTable(this.plan, blocks, palette)
    this.detail = roundColors(this.table, blocks, palette, this.textureDefs)
  }

  private loadImage(url: string): Promise<HTMLImageElement | null> {
    let p = this.images.get(url)
    if (!p) {
      p = new Promise((resolve) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => {
          log.error(`failed to load texture image ${url}`)
          resolve(null)
        }
        img.src = url
      })
      this.images.set(url, p)
    }
    return p
  }
}

function drawPattern(
  g: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  fn: PatternFn,
  def: Pick<TextureDef, 'colors' | 'seed' | 'params'>,
): void {
  const data = g.createImageData(TILE, TILE)
  const rand = mulberry32(def.seed)
  const ctx: PatternContext = {
    size: TILE,
    colors: [...def.colors],
    params: { ...def.params },
    rand,
    shade,
    px(x, y, c) {
      if (x < 0 || y < 0 || x >= TILE || y >= TILE) return
      const [r, gg, b] = typeof c === 'string' ? shade(c, 1) : c
      const i = (Math.floor(y) * TILE + Math.floor(x)) * 4
      data.data[i] = r
      data.data[i + 1] = gg
      data.data[i + 2] = b
      data.data[i + 3] = 255
    },
  }
  try {
    fn(ctx)
  } catch (e) {
    log.error('pattern failed', e)
  }
  g.putImageData(data, x0, y0)
}

/** Detail slots the shader can tell apart (and look up variants for; terrainMaterial's MAX_SLOTS). */
export const MAX_DETAIL_SLOTS = 16

/** What the rounded island shows close up: materials by slot, and the patches that vary them. */
export interface DetailPlan {
  materials: string[]
  /** Per slot: first variant slot, number of variants (0: none). */
  variants: Float32Array
  /** Per slot (variant slots): tint r, g, b (linear) and the share of the ground it covers. */
  looks: Float32Array
}

/**
 * Colors and detail materials for the rounded island: each block's top and sides get the average
 * color of their texture (no pixels), and the texture's `material` becomes a detail slot; its
 * `variants` get slots right after the base materials.
 * Fills the table's topColor / sideColor / detailTop / detailSide; returns the plan of slots.
 */
export function roundColors(table: BlockTable, blocks: BlockDef[], palette: BlockPalette, textures: (id: string) => TextureDef | undefined): DetailPlan {
  const n = table.kind.length
  const top = new Float32Array(n * 3).fill(0.8)
  const side = new Float32Array(n * 3).fill(0.8)
  const detailTop = new Int16Array(n).fill(-1)
  const detailSide = new Int16Array(n).fill(-1)
  const slots: string[] = []
  /** Base material → the texture that named it first (its variants). */
  const varied = new Map<string, NonNullable<TextureDef['variants']>>()
  const slotOf = (m: string | undefined) => {
    if (!m) return -1
    let i = slots.indexOf(m)
    if (i < 0) i = slots.push(m) - 1
    return i
  }
  for (const b of blocks) {
    const num = palette.peek(b.id)
    if (num === undefined || num >= n) continue
    const faces = faceTextures(b)
    const fill = (out: Float32Array, texId: string) => {
      const t = textures(texId)
      // the texture's own colors, the first counting most; the block's color without one
      const cols = t?.colors?.length && !t.url ? t.colors : [b.color ?? '#cccccc']
      let r = 0
      let g = 0
      let bl = 0
      let w = 0
      cols.forEach((c, i) => {
        const k = i === 0 ? 2 : 1
        const [cr, cg, cb] = shade(c, 1)
        r += cr * k
        g += cg * k
        bl += cb * k
        w += k
      })
      // sRGB → linear (vertex colors are linear)
      const lin = (v: number) => Math.pow(v / w / 255, 2.2)
      out[num * 3] = lin(r)
      out[num * 3 + 1] = lin(g)
      out[num * 3 + 2] = lin(bl)
      if (t?.material && t.variants?.length && !varied.has(t.material)) varied.set(t.material, t.variants)
      return t?.material
    }
    detailTop[num] = slotOf(fill(top, faces[2]!))
    detailSide[num] = slotOf(fill(side, faces[4]!))
  }
  table.topColor = top
  table.sideColor = side
  table.detailTop = detailTop
  table.detailSide = detailSide
  const variants = new Float32Array(MAX_DETAIL_SLOTS * 2)
  const looks = new Float32Array(MAX_DETAIL_SLOTS * 4)
  for (const [base, list] of varied) {
    const b = slots.indexOf(base)
    const first = slots.length
    let count = 0
    for (const v of list) {
      if (slots.length >= MAX_DETAIL_SLOTS) break
      const s = slots.push(v.material) - 1
      const [r, g, bl] = shade(v.tint, 1)
      looks.set([Math.pow(r / 255, 2.2), Math.pow(g / 255, 2.2), Math.pow(bl / 255, 2.2), v.share], s * 4)
      count++
    }
    if (b < MAX_DETAIL_SLOTS && count) variants.set([first, count], b * 2)
  }
  return { materials: slots, variants, looks }
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
