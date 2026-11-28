import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat } from 'three'
import type { MaterialService } from '../materials/MaterialService'
import type { DetailPlan } from './BlockAtlas'
import { terrainUniforms } from './terrainMaterial'

const COLS = 4

/**
 * The rounded island's detail atlas: each material a block texture names (grass, rock, sand…) as a
 * grey tile around 0.5 (its light and shade, normalized), laid out in a grid. Mipmaps make the
 * detail fade with distance by themselves — no pixels, no popping.
 */
export class TerrainDetail {
  private token = 0
  private texture: DataTexture | null = null
  private last: { plan: DetailPlan; size: number } | null = null

  constructor(private materials: MaterialService) {}

  /** Rebuild at another tile size (same materials). */
  resize(size: number, anisotropy?: number): void {
    if (this.last && this.last.size !== size) void this.build(this.last.plan, size, anisotropy)
  }

  /** Texels of one tile; `anisotropy` the most the GPU takes. */
  async build(plan: DetailPlan, SIZE: number, anisotropy = 8): Promise<void> {
    this.last = { plan, size: SIZE }
    const ids = plan.materials
    const token = ++this.token
    const rows = Math.max(1, Math.ceil(ids.length / COLS))
    const W = COLS * SIZE
    const H = rows * SIZE
    const data = new Uint8Array(W * H * 4).fill(128)
    for (let i = 3; i < data.length; i += 4) data[i] = 255
    await Promise.all(
      ids.map(async (id, slot) => {
        if (!this.materials.has(id)) return
        const px = await this.materials.render(id, SIZE)
        if (!px || token !== this.token) return
        let mean = 0
        const n = SIZE * SIZE
        for (let i = 0; i < n; i++) mean += px[i * 4]! * 0.299 + px[i * 4 + 1]! * 0.587 + px[i * 4 + 2]! * 0.114
        mean = Math.max(1, mean / n)
        const ox = (slot % COLS) * SIZE
        const oy = Math.floor(slot / COLS) * SIZE
        for (let y = 0; y < SIZE; y++)
          for (let x = 0; x < SIZE; x++) {
            const s = (y * SIZE + x) * 4
            const lum = px[s]! * 0.299 + px[s + 1]! * 0.587 + px[s + 2]! * 0.114
            const v = Math.min(255, Math.round((128 * lum) / mean))
            const o = ((oy + y) * W + ox + x) * 4
            data[o] = data[o + 1] = data[o + 2] = v
          }
      }),
    )
    if (token !== this.token) return
    const tex = new DataTexture(data, W, H, RGBAFormat)
    tex.magFilter = LinearFilter
    tex.minFilter = LinearMipmapLinearFilter
    tex.generateMipmaps = true
    tex.anisotropy = anisotropy
    tex.needsUpdate = true
    this.texture?.dispose()
    this.texture = tex
    terrainUniforms.uDetailAtlas.value = tex
    terrainUniforms.uDetailGrid.value = [COLS, rows]
    terrainUniforms.uVariants.value = plan.variants
    terrainUniforms.uVariantLooks.value = plan.looks
  }
}
