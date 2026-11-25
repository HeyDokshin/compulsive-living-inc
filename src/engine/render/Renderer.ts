import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  AxesHelper,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  MathUtils,
  Mesh,
  NeutralToneMapping,
  NoToneMapping,
  PCFShadowMap,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import type { EngineConfig } from '../engineConfig'
import type { TickContext } from '../types'
import type { Entities } from '../ecs/Entities'
import type { ModelLibrary } from '../models/ModelLibrary'
import { EntityRenderer } from './EntityRenderer'
import { IsoCamera } from './IsoCamera'
import { BlockAtlas } from './BlockAtlas'
import { ChunkRenderer } from './ChunkRenderer'
import { createLightState, sampleLight, type LightState } from './dayCycle'
import type { VoxelWorld } from '../world/VoxelWorld'
import { MesherPool } from '../world/mesher/MesherPool'
import { PostFX } from './PostFX'
import { inView, shadowHalf, type CullView } from './ViewCull'
import { stylize, styleUniforms, type StyleOptions } from './style'
import { pickCurved, type VoxelHit } from '../world/pick'

/** [x0, z0, x1, z1] or [x0, z0, x1, z1, cellSize] in world units. */
export type SurfaceRect = [number, number, number, number] | [number, number, number, number, number]

/** three.js scene, lights + day cycle, iso camera, voxel chunks, and the `model` → `view` sync for entities. */
export class Renderer {
  readonly scene = new Scene()
  readonly renderer: WebGLRenderer
  readonly iso: IsoCamera
  readonly sun = new DirectionalLight()
  readonly ambient = new HemisphereLight()
  private grid?: GridHelper
  private axes?: AxesHelper
  private resizeObserver: ResizeObserver
  readonly atlas: BlockAtlas
  readonly chunks: ChunkRenderer
  readonly mesher = new MesherPool()
  readonly postfx: PostFX
  private surfaces = new Set<{ mesh: Mesh; blockId: string; cull?: { x: number; y: number; z: number; r: number } }>()
  private palette: VoxelWorld['palette']
  readonly entityRenderer: EntityRenderer
  /** Seed for lawn color patches (set from the world seed). */
  tintSeed = 1

  constructor(
    private container: HTMLElement,
    private cfg: EngineConfig,
    entities: Entities,
    private world: VoxelWorld,
    library: ModelLibrary,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, stencil: true })
    this.renderer.shadowMap.type = PCFShadowMap
    // asking the driver about errors waits for every shader: only while developing
    this.renderer.debug.checkShaderErrors = import.meta.env?.DEV === true
    container.appendChild(this.renderer.domElement)
    this.iso = new IsoCamera(cfg.camera)

    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    const s = this.sun.shadow.camera
    s.near = 1
    s.far = 400
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.04
    this.scene.add(this.sun, this.sun.target, this.ambient)

    this.atlas = new BlockAtlas()
    this.chunks = new ChunkRenderer(world, this.atlas, this.mesher)
    this.scene.add(this.chunks.group)
    this.palette = world.palette
    this.postfx = new PostFX(this.renderer, this.scene, this.iso.camera)

    this.entityRenderer = new EntityRenderer(this.scene, entities, library, world)
    this.entityRenderer.inView = this.chunks.inView = (x, y, z, r) => inView(this.cull, x, y, z, r)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
    this.applyConfig()
  }

  /** Re-apply config values that are not read every frame. */
  applyConfig(): void {
    const { render, light, debug } = this.cfg
    this.renderer.shadowMap.enabled = render.shadows
    this.sun.castShadow = render.shadows
    if (this.sun.shadow.mapSize.x !== render.shadowMapSize) {
      this.sun.shadow.mapSize.set(render.shadowMapSize, render.shadowMapSize)
      this.sun.shadow.map?.dispose() // re-created at the new size on the next frame
      this.sun.shadow.map = null
    }
    if (!light.dayCycle) {
      this.scene.background = new Color(render.background)
      this.sun.color.set(light.sunColor)
      this.sun.intensity = light.sunIntensity
      this.ambient.color.set(light.skyColor)
      this.ambient.groundColor.set(light.groundColor)
      this.ambient.intensity = light.ambientIntensity
    }

    // Mesh-affecting settings: remesh only when they actually change.
    const ao = render.ao
    const curve: [number, number, number, number] = [1 - ao * 0.75, 1 - ao * 0.5, 1 - ao * 0.25, 1]
    const style = this.cfg.style
    const t = render.tint
    const toMul = (hex: string): [number, number, number] => {
      const c = this.tmpColor.set(hex).convertLinearToSRGB()
      return [c.r, c.g, c.b]
    }
    const tint = { seed: this.tintSeed, scale: t.scale, strength: t.strength, a: toMul(t.sunny), b: toMul(t.shady) }
    const maxMerge = style.curvature > 0 ? 1 : Infinity
    const meshKey = JSON.stringify([curve, tint, maxMerge])
    if (meshKey !== this.last.mesh) {
      this.last.mesh = meshKey
      this.chunks.aoCurve = curve
      this.chunks.tint = tint
      this.chunks.maxMerge = maxMerge
      this.chunks.remeshAll()
    }
    this.chunks.waterOpacity = render.waterOpacity
    if (debug.showChunks !== this.last.borders) {
      this.last.borders = debug.showChunks
      this.chunks.setBorders(debug.showChunks)
    }

    this.renderer.toneMapping = { neutral: NeutralToneMapping, agx: AgXToneMapping, aces: ACESFilmicToneMapping, none: NoToneMapping }[style.toneMapping]
    this.renderer.toneMappingExposure = style.exposure
    this.sun.shadow.intensity = style.shadowStrength
    styleUniforms.uWaterSpeed.value = style.waterSpeed
    this.postfx.setSamples(render.msaa)
    this.postfx.apply(style)

    if (debug.showGrid && !this.grid) this.scene.add((this.grid = new GridHelper(256, 256, 0x335566, 0x557788)))
    if (!debug.showGrid && this.grid) (this.grid.removeFromParent(), (this.grid = undefined))
    if (debug.showAxes && !this.axes) this.scene.add((this.axes = new AxesHelper(4)))
    if (!debug.showAxes && this.axes) (this.axes.removeFromParent(), (this.axes = undefined))

    // Resizing reallocates render targets: only when the pixel ratio really changed.
    const ratio = Math.min(window.devicePixelRatio, render.maxPixelRatio)
    if (ratio !== this.last.ratio) {
      this.last.ratio = ratio
      this.renderer.setPixelRatio(ratio)
      this.resize()
    }
  }

  /** Values from the previous applyConfig, to skip expensive work when nothing changed. */
  private last = { mesh: '', borders: false, ratio: 0 }
  private tmpColor = new Color()
  private lightState = createLightState()
  /** Per-frame light adjustment (the engine routes it through the `light:adjust` hook — weather). */
  adjustLight?: (state: LightState, hour: number) => LightState

  /** Engine system, start of each tick: remember transforms so rendering can interpolate. */
  snapshot(): void {
    this.entityRenderer.snapshot()
  }

  /** What the camera sees, refreshed every frame. */
  private cull: CullView = { x: 0, y: 0, z: 0, fx: 0, fz: -1, halfW: 1, halfH: 1, pitch: 1, curvature: 0, margin: 0 }

  private updateCull(): void {
    const c = this.cull
    const cam = this.iso.camera
    const f = this.iso.forwardXZ()
    c.x = this.iso.target.x
    c.y = this.iso.target.y
    c.z = this.iso.target.z
    c.fx = f.x
    c.fz = f.z
    c.halfW = cam.right
    c.halfH = cam.top
    c.pitch = MathUtils.degToRad(this.cfg.camera.pitch)
    c.curvature = this.cfg.style.curvature
    c.margin = this.cfg.render.cullMargin
  }

  render(ctx: TickContext): void {
    this.updateCull()
    this.entityRenderer.render(ctx)
    this.chunks.cull()
    // layers, not `visible`: the owner decides whether a surface is shown at all
    for (const s of this.surfaces) if (s.cull) s.mesh.layers.mask = inView(this.cull, s.cull.x, s.cull.y, s.cull.z, s.cull.r) ? 1 : 0

    this.iso.update(ctx.dt)
    this.chunks.update(this.iso.target.x, this.iso.target.z)
    this.updateLight(ctx.dt)
    if (this.grid) this.grid.position.set(Math.round(this.iso.target.x), Math.round(this.iso.target.y) + 0.01, Math.round(this.iso.target.z))

    styleUniforms.uTime.value += ctx.dt
    styleUniforms.uCurve.value = this.cfg.style.curvature
    styleUniforms.uCurveCenter.value.copy(this.iso.target)
    const f = this.iso.forwardXZ()
    styleUniforms.uCurveDir.value.set(f.x, f.z)
    if (this.cfg.style.postfx) {
      this.postfx.setTiltScale(Math.min(1, this.cfg.style.tiltShiftZoom / this.iso.currentZoom))
      this.postfx.render(ctx.dt)
    }
    else this.renderer.render(this.scene, this.iso.camera)
  }

  /** Compile every material of the scene now (in the background where the browser can) instead of on first sight. */
  async warmUp(): Promise<void> {
    const target = this.renderer.getRenderTarget()
    if (this.cfg.style.postfx) this.renderer.setRenderTarget(this.postfx.composer.renderTarget1)
    const done = this.renderer.compileAsync(this.scene, this.iso.camera)
    this.renderer.setRenderTarget(target)
    await done
  }

  private pickOrigin = new Vector3()
  private pickDir = new Vector3()

  /** The voxel under a screen point (client pixels), corrected for world curvature. */
  pick(clientX: number, clientY: number): VoxelHit | null {
    const r = this.renderer.domElement.getBoundingClientRect()
    const nx = ((clientX - r.left) / r.width) * 2 - 1
    const ny = -((clientY - r.top) / r.height) * 2 + 1
    const cam = this.iso.camera
    const o = this.pickOrigin.set(nx, ny, -1).unproject(cam)
    cam.getWorldDirection(this.pickDir)
    const v = this.world
    return pickCurved(o, this.pickDir, (x, y, z) => v.get(x, y, z) !== 0, 1200, {
      k: this.cfg.style.curvature,
      center: this.iso.target,
      forward: this.iso.forwardXZ(),
    })
  }

  /** Apply the game's look (curvature, sway…) to a custom material. */
  stylize<T extends Parameters<typeof stylize>[0]>(material: T, opts?: StyleOptions): T {
    return stylize(material, opts)
  }

  /**
   * Flat surfaces textured like a block's top face (e.g. the endless sea around the island).
   * Rects are [x0, z0, x1, z1] in world units. Kept in sync with atlas rebuilds.
   */
  createBlockSurface(blockId: string, rects: SurfaceRect[], y: number, transparent: boolean, cull = false): Mesh {
    const pos: number[] = []
    const uv: number[] = []
    const idx: number[] = []
    // Each rect is split into cells (5th value, default: one quad) so vertex effects such as
    // world curvature can bend it smoothly.
    for (const [x0, z0, x1, z1, cell] of rects) {
      const step = cell && cell > 0 ? cell : Math.max(x1 - x0, z1 - z0)
      for (let cz = z0; cz < z1; cz += step) {
        for (let cx = x0; cx < x1; cx += step) {
          const ax = cx
          const az = cz
          const bx = Math.min(x1, cx + step)
          const bz = Math.min(z1, cz + step)
          const s = pos.length / 3
          pos.push(ax, y, az, bx, y, az, bx, y, bz, ax, y, bz)
          uv.push(ax, az, bx, az, bx, bz, ax, bz)
          idx.push(s, s + 2, s + 1, s, s + 3, s + 2)
        }
      }
    }
    const n = pos.length / 3
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
    geo.setAttribute('normal', new BufferAttribute(new Float32Array(n * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3))
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
    geo.setAttribute('color', new BufferAttribute(new Float32Array(n * 3).fill(1), 3))
    geo.setAttribute('tile', new BufferAttribute(new Float32Array(n * 4), 4))
    geo.setIndex(idx)
    const mesh = new Mesh(geo, transparent ? this.chunks.transparentMaterial : this.chunks.opaqueMaterial)
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    const entry: { mesh: Mesh; blockId: string; cull?: { x: number; y: number; z: number; r: number } } = { mesh, blockId }
    if (cull) {
      geo.computeBoundingSphere()
      const b = geo.boundingSphere!
      entry.cull = { x: b.center.x, y: b.center.y, z: b.center.z, r: b.radius }
    }
    this.surfaces.add(entry)
    this.updateSurfaceTiles(entry)
    mesh.addEventListener('removed', () => this.surfaces.delete(entry))
    return mesh
  }

  /** Call after the atlas changed. */
  refreshSurfaces(): void {
    for (const s of this.surfaces) this.updateSurfaceTiles(s)
  }

  private updateSurfaceTiles(s: { mesh: Mesh; blockId: string }): void {
    const t = this.atlas.table.tiles
    const num = this.palette.peek(s.blockId)
    const base = num !== undefined && (num * 6 + 2) * 4 + 3 < t.length ? (num * 6 + 2) * 4 : 8
    const attr = s.mesh.geometry.getAttribute('tile') as BufferAttribute
    for (let i = 0; i < attr.count; i++) attr.setXYZW(i, t[base]!, t[base + 1]!, t[base + 2]!, t[base + 3]!)
    attr.needsUpdate = true
  }

  dispose(): void {
    this.postfx.dispose()
    this.chunks.dispose()
    this.mesher.dispose()
    this.resizeObserver.disconnect()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  /** Sun/moon direction and colors: from the day-cycle curve, or the static light settings. */
  private updateLight(dt: number): void {
    const light = this.cfg.light
    let dir: [number, number, number]
    if (light.dayCycle) {
      if (light.timeSpeed > 0) light.time = (light.time + light.timeSpeed * dt) % 24
      let st = sampleLight(light.keys, light.time, light.sunAzimuth, light.maxElevation, this.lightState)
      if (this.adjustLight) st = this.adjustLight(st, light.time)
      this.sun.color.copy(st.sun)
      this.sun.intensity = st.sunIntensity
      this.ambient.color.copy(st.sky)
      this.ambient.groundColor.copy(st.ground)
      this.ambient.intensity = st.ambient
      if (this.scene.background instanceof Color) this.scene.background.copy(st.background)
      else this.scene.background = st.background.clone()
      dir = st.dir
    } else {
      const az = MathUtils.degToRad(light.sunAzimuth)
      const el = MathUtils.degToRad(light.sunElevation)
      dir = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)]
    }
    this.placeSun(dir)
  }

  private sunRight = new Vector3()
  private sunUp = new Vector3()
  private sunDir = new Vector3()
  private sunAt = new Vector3()

  /**
   * Point the sun at the picture. The shadow map covers only what is on screen (sharper, and far fewer
   * things to draw into it) and moves in whole texels, so shadows don't crawl while walking.
   */
  private placeSun(dir: [number, number, number]): void {
    const { render, style } = this.cfg
    const half = shadowHalf(this.cull, render.shadowMargin, render.shadowRange)
    const sc = this.sun.shadow.camera
    if (sc.right !== half) {
      sc.left = sc.bottom = -half
      sc.right = sc.top = half
      sc.updateProjectionMatrix()
    }
    const texel = (2 * half) / render.shadowMapSize
    this.sun.shadow.radius = Math.min(style.shadowSoftness * 4, style.shadowSoftness * (render.softnessTexel / texel))
    const d = this.sunDir.set(dir[0], dir[1], dir[2]).normalize()
    const right = this.sunRight.set(d.z, 0, -d.x)
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0)
    right.normalize()
    const up = this.sunUp.crossVectors(d, right)
    const at = this.sunAt.copy(this.iso.target)
    const r = at.dot(right)
    const u = at.dot(up)
    at.addScaledVector(right, Math.round(r / texel) * texel - r).addScaledVector(up, Math.round(u / texel) * texel - u)
    this.sun.target.position.copy(at)
    this.sun.position.copy(at).addScaledVector(d, 150)
  }

  private resize(): void {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    this.renderer.setSize(w, h, false)
    this.postfx?.setSize(w, h, this.renderer.getPixelRatio())
    this.postfx?.apply(this.cfg.style)
    this.iso.resize(w, h)
  }
}
