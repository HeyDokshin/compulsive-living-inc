import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, type Texture } from 'three'
import type { MaterialService } from '../materials/MaterialService'

/** Shared by every character material: how much fabric detail shows (grows in with the zoom). */
export const fabricUniforms = {
  uMatFade: { value: 0 },
}

/**
 * Procedural materials as fabric detail on characters (knit, denim, linen…). Each material becomes a
 * grey "detail" texture around 0.5 (its brightness, normalized), which multiplies the painted
 * color — so recolored clothes keep their color and get the weave. The texture size follows the
 * zoom; every user of a material shares one uniform, so swapping the picture updates them all.
 */
export class FabricTextures {
  private uniforms = new Map<string, { value: Texture }>()
  private level = 0
  private token = 0
  private readonly neutral: DataTexture

  constructor(private materials: MaterialService) {
    this.neutral = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, RGBAFormat)
    this.neutral.needsUpdate = true
  }

  /** The uniform holding material `id`'s detail texture (neutral until it is rendered). */
  uniform(id: string): { value: Texture } {
    let u = this.uniforms.get(id)
    if (!u) {
      u = { value: this.neutral }
      this.uniforms.set(id, u)
      if (this.level) void this.render(id, u, this.level, this.token)
    }
    return u
  }

  /** Materials changed: render them again. */
  invalidate(): void {
    const level = this.level
    this.level = 0
    if (level) this.setLevel(level)
  }

  /** Texels per tile wanted now (a power of two); re-renders when it changes. */
  setLevel(level: number): void {
    if (level === this.level) return
    this.level = level
    const token = ++this.token
    for (const [id, u] of this.uniforms) void this.render(id, u, level, token)
  }

  private async render(id: string, u: { value: Texture }, level: number, token: number): Promise<void> {
    // not loaded yet: stays plain until the materials arrive (they invalidate)
    if (!this.materials.has(id)) return
    const px = await this.materials.render(id, level)
    if (!px || token !== this.token) return
    const n = level * level
    let mean = 0
    for (let i = 0; i < n; i++) mean += px[i * 4]! * 0.299 + px[i * 4 + 1]! * 0.587 + px[i * 4 + 2]! * 0.114
    mean = Math.max(1, mean / n)
    const data = new Uint8Array(n * 4)
    for (let i = 0; i < n; i++) {
      const lum = px[i * 4]! * 0.299 + px[i * 4 + 1]! * 0.587 + px[i * 4 + 2]! * 0.114
      const v = Math.min(255, Math.round((128 * lum) / mean))
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v
      data[i * 4 + 3] = 255
    }
    const tex = new DataTexture(data, level, level, RGBAFormat)
    tex.wrapS = tex.wrapT = RepeatWrapping
    tex.magFilter = LinearFilter
    tex.minFilter = LinearMipmapLinearFilter
    tex.generateMipmaps = true
    tex.needsUpdate = true
    const old = u.value
    u.value = tex
    if (old !== this.neutral) old.dispose()
  }
}
