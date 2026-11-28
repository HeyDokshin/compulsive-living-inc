import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  OrthographicCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderTarget,
  type Object3D,
  type WebGLRenderer,
} from 'three'
import type { ModelLibrary } from '../models/ModelLibrary'
import { styleUniforms } from './style'

/**
 * Item icons drawn from the things themselves: the model as the game shows it (soft edges, flat rugs,
 * materials), lit softly, seen from the iso angle — or tilted on its side for long tools — rendered
 * off screen and read back as a picture. The world's curve is switched off while it draws.
 */
export class IconRenderer {
  private scene = new Scene()
  private camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 100)
  private target: WebGLRenderTarget
  private holder = new Group()
  private box = new Box3()
  private size = new Vector3()
  private center = new Vector3()
  private clear = new Color()

  constructor(
    private renderer: WebGLRenderer,
    private library: ModelLibrary,
    private px = 128,
  ) {
    this.target = new WebGLRenderTarget(px, px, { samples: 4 })
    this.target.texture.colorSpace = SRGBColorSpace
    const sun = new DirectionalLight('#fff4e6', 2.2)
    sun.position.set(3, 6, 4)
    this.scene.add(new HemisphereLight('#ffffff', '#c9b8a8', 1.6), new AmbientLight('#ffffff', 0.35), sun, this.holder)
  }

  /** A PNG data URL of the model, or null if it cannot be drawn (unknown, empty). */
  async draw(modelId: string, palette: Record<string, string> | undefined, style: 'iso' | 'sprite'): Promise<string | null> {
    if (!(await this.library.getModel(modelId, palette))) return null
    const obj = this.library.createVoxel(modelId, { palette })
    if (!obj.children.length) return null // empty model
    this.holder.clear()
    this.holder.add(obj)
    this.holder.rotation.set(0, 0, 0)
    // long tools lie across the picture; everything else is seen from the iso angle
    if (style === 'sprite') this.holder.rotation.set(0, 0, -Math.PI / 4.5)
    this.frame(obj, style)
    const r = this.renderer
    const before = r.getRenderTarget()
    const curve = styleUniforms.uCurve.value
    r.getClearColor(this.clear)
    const alpha = r.getClearAlpha()
    const info = { calls: r.info.render.calls, triangles: r.info.render.triangles }
    styleUniforms.uCurve.value = 0
    r.setRenderTarget(this.target)
    r.setClearColor(0x000000, 0)
    r.clear()
    r.render(this.scene, this.camera)
    const pixels = new Uint8Array(this.px * this.px * 4)
    r.readRenderTargetPixels(this.target, 0, 0, this.px, this.px, pixels)
    r.setRenderTarget(before)
    r.setClearColor(this.clear, alpha)
    styleUniforms.uCurve.value = curve
    // the frame being counted for the game is not this one
    r.info.render.calls = info.calls
    r.info.render.triangles = info.triangles
    this.holder.clear()
    return toDataUrl(pixels, this.px)
  }

  /** Point the camera at the object so it fills the picture with a little margin. */
  private frame(obj: Object3D, style: 'iso' | 'sprite'): void {
    this.holder.updateMatrixWorld(true)
    this.box.setFromObject(obj)
    this.box.getCenter(this.center)
    this.box.getSize(this.size)
    // flat things lying down (rugs) are seen from nearly above, the rest from the iso angle
    const lying = this.size.y < 0.15 * Math.max(this.size.x, this.size.z)
    const dir = style === 'sprite' ? new Vector3(0, 0.15, 1) : lying ? new Vector3(0.35, 1.6, 0.45) : new Vector3(1, 0.95, 1)
    dir.normalize()
    const d = this.size.length() * 2 + 1
    this.camera.position.copy(this.center).addScaledVector(dir, d)
    this.camera.lookAt(this.center)
    this.camera.updateMatrixWorld(true)
    // fit: project the box corners into the camera and size the view to them
    let half = 0
    const v = new Vector3()
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? this.box.max.x : this.box.min.x, i & 2 ? this.box.max.y : this.box.min.y, i & 4 ? this.box.max.z : this.box.min.z)
      v.applyMatrix4(this.camera.matrixWorldInverse)
      half = Math.max(half, Math.abs(v.x), Math.abs(v.y))
    }
    half *= 1.08
    Object.assign(this.camera, { left: -half, right: half, top: half, bottom: -half, near: 0.01, far: d * 2 })
    this.camera.updateProjectionMatrix()
  }

  dispose(): void {
    this.target.dispose()
  }
}

/** Pixels read back from WebGL (bottom row first) → a PNG data URL. */
function toDataUrl(pixels: Uint8Array, px: number): string {
  const c = document.createElement('canvas')
  c.width = c.height = px
  const g = c.getContext('2d')!
  const img = g.createImageData(px, px)
  for (let y = 0; y < px; y++) img.data.set(pixels.subarray((px - 1 - y) * px * 4, (px - y) * px * 4), y * px * 4)
  g.putImageData(img, 0, 0)
  return c.toDataURL('image/png')
}
