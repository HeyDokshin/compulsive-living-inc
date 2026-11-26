import { CanvasTexture, LinearFilter, SRGBColorSpace, type Texture } from 'three'
import type { MaterialService } from '../materials/MaterialService'
import type { BlockAtlas } from './BlockAtlas'
import { TILE, type TextureDef } from './textures'

/** Shared by the block materials: the detail atlas and the one it fades over (crossfades). */
export const detailUniforms = {
  uDetail: { value: null as Texture | null },
  uDetailW: { value: 0 },
  uDetailRes: { value: TILE },
  uDetailPrev: { value: null as Texture | null },
  uDetailPrevW: { value: 0 },
  uDetailPrevRes: { value: TILE },
}

export interface DetailSettings {
  /** Texels per screen pixel to aim for (1 = one texel per pixel). */
  bias: number
  /** Largest texels per block. */
  max: number
  /** Seconds a crossfade between detail levels takes. */
  fade: number
}

/** Next detail level for this many screen pixels per block: up when short of texels, down well past it. */
export function nextDetailLevel(current: number, pixelsPerBlock: number, s: Pick<DetailSettings, 'bias' | 'max'>): number {
  const want = pixelsPerBlock * s.bias
  let t = current
  while (t < s.max && want > t * 1.15) t *= 2
  while (t > TILE && want < t * 0.4) t /= 2
  return Math.min(Math.max(TILE, s.max), Math.max(TILE, t))
}

/**
 * Close-up texture detail for blocks. The 16-texel atlas keeps the soft pixel look from afar;
 * as the camera comes closer, a finer copy of the atlas is built for the zoom (textures with a
 * `material` get the real procedural surface there, others stay crisp pixel art) and faded in over
 * the old one. Levels are kept, so zooming back and forth is instant.
 */
export class AtlasDetail {
  /** Level wanted for the current zoom (16 = none). */
  private target = TILE
  /** Level drawn on top right now (16 = none). */
  private shown = TILE
  private levels = new Map<number, CanvasTexture | null>()
  private token = 0
  private hasMaterials = false

  constructor(
    private atlas: BlockAtlas,
    private materials: MaterialService,
    private textures: (id: string) => TextureDef | undefined,
  ) {}

  /** The atlas or a material changed: rebuild what is shown. */
  invalidate(): void {
    this.token++
    for (const t of this.levels.values()) t?.dispose()
    this.levels.clear()
    this.hasMaterials = this.atlas.plan.tiles.some((id) => !!this.textures(id)?.material)
    const u = detailUniforms
    u.uDetail.value = u.uDetailPrev.value = null
    u.uDetailW.value = u.uDetailPrevW.value = 0
    this.shown = TILE
  }

  /** Every frame: pick the level for the zoom and keep crossfades moving. */
  update(pixelsPerBlock: number, s: DetailSettings, dt: number): void {
    const u = detailUniforms
    const want = this.hasMaterials ? nextDetailLevel(this.target, pixelsPerBlock, s) : TILE
    if (want !== this.target) {
      this.target = want
      if (want > TILE && !this.levels.has(want)) this.build(want)
    }
    // the wanted level is ready: put it on top, fading in over what was there
    if (this.target !== this.shown) {
      const tex = this.target > TILE ? this.levels.get(this.target) : null
      if (this.target === TILE || tex) {
        if (u.uDetail.value && u.uDetailW.value > 0) {
          u.uDetailPrev.value = u.uDetail.value
          u.uDetailPrevRes.value = u.uDetailRes.value
          u.uDetailPrevW.value = u.uDetailW.value
        }
        u.uDetail.value = tex ?? null
        u.uDetailRes.value = this.target
        u.uDetailW.value = 0
        this.shown = this.target
      }
    }
    const k = s.fade > 0 ? dt / s.fade : 1
    if (u.uDetail.value) {
      u.uDetailW.value = Math.min(1, u.uDetailW.value + k)
      // the new level covers the old one fully: let it go
      if (u.uDetailW.value >= 1) {
        u.uDetailPrevW.value = 0
        u.uDetailPrev.value = null
      }
    } else if (u.uDetailPrevW.value > 0) {
      // back to plain pixels: the last level fades out
      u.uDetailPrevW.value = Math.max(0, u.uDetailPrevW.value - k)
      if (u.uDetailPrevW.value === 0) u.uDetailPrev.value = null
    }
  }

  private async build(level: number): Promise<void> {
    const token = this.token
    this.levels.set(level, null) // building
    const plan = this.atlas.plan
    const scale = level / TILE
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = plan.size * scale
    const g = canvas.getContext('2d')!
    g.imageSmoothingEnabled = false
    // pixel-art tiles: the base atlas, enlarged without blurring
    g.drawImage(this.atlas.canvas, 0, 0, plan.size, plan.size, 0, 0, canvas.width, canvas.height)
    const jobs = plan.tiles.map(async (id, i) => {
      const def = this.textures(id)
      if (!def?.material || level < def.materialFrom) return
      const pixels = await this.materials.render(def.material, level)
      if (!pixels || token !== this.token) return
      const x0 = (i % plan.cols) * level
      const y0 = Math.floor(i / plan.cols) * level
      g.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer, pixels.byteOffset, level * level * 4), level, level), x0, y0)
    })
    await Promise.all(jobs)
    if (token !== this.token) return
    const tex = new CanvasTexture(canvas)
    tex.colorSpace = SRGBColorSpace
    tex.magFilter = LinearFilter
    tex.minFilter = LinearFilter
    tex.generateMipmaps = false
    this.levels.set(level, tex)
    // keep a few levels around, drop the farthest from what is wanted
    if (this.levels.size > 3) {
      const far = [...this.levels.keys()].filter((l) => l !== this.shown && l !== this.target).sort((a, b) => Math.abs(b - this.target) - Math.abs(a - this.target))[0]
      if (far !== undefined) {
        this.levels.get(far)?.dispose()
        this.levels.delete(far)
      }
    }
  }
}
