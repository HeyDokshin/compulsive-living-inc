import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace, type Texture } from 'three'
import type { MaterialService } from '../materials/MaterialService'

/**
 * Procedural materials as ready textures for plugins (room walls, floors, trims…): tiling, sRGB,
 * mipmapped. One texture per material and size, shared; it shows a plain mid-grey until the picture
 * is rendered and fills in when the material changes (hot reload) — the same texture object stays.
 */
export class MaterialTextures {
  private textures = new Map<string, { texture: DataTexture; version: number }>()

  constructor(
    private materials: MaterialService,
    private anisotropy: () => number,
  ) {}

  get(id: string, size: number): Texture {
    const key = `${id}@${size}`
    let entry = this.textures.get(key)
    if (!entry) {
      const tex = new DataTexture(new Uint8Array([200, 200, 200, 255]), 1, 1, RGBAFormat)
      tex.colorSpace = SRGBColorSpace
      tex.wrapS = tex.wrapT = RepeatWrapping
      tex.magFilter = LinearFilter
      tex.minFilter = LinearMipmapLinearFilter
      tex.generateMipmaps = true
      tex.needsUpdate = true
      entry = { texture: tex, version: -1 }
      this.textures.set(key, entry)
    }
    if (entry.version !== this.materials.version) this.fill(id, size, entry)
    return entry.texture
  }

  private fill(id: string, size: number, entry: { texture: DataTexture; version: number }): void {
    const version = (entry.version = this.materials.version)
    void this.materials.render(id, size).then((px) => {
      if (!px || entry.version !== version) return
      const tex = entry.texture
      // a new size of picture needs a fresh GPU texture: same object, re-uploaded
      tex.image = { data: new Uint8Array(px), width: size, height: size }
      tex.anisotropy = this.anisotropy()
      tex.dispose()
      tex.needsUpdate = true
    })
  }

  dispose(): void {
    for (const e of this.textures.values()) e.texture.dispose()
    this.textures.clear()
  }
}
