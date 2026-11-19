import {
  AxesHelper,
  BoxGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshLambertMaterial,
  PCFShadowMap,
  Scene,
  WebGLRenderer,
  type Object3D,
} from 'three'
import type { EngineConfig } from '../engineConfig'
import type { Entity, ModelSpec, TickContext, Transform } from '../types'
import type { Entities } from '../ecs/Entities'
import { IsoCamera } from './IsoCamera'
import { BlockAtlas } from './BlockAtlas'
import { ChunkRenderer } from './ChunkRenderer'
import { sampleLight } from './dayCycle'
import type { VoxelWorld } from '../world/VoxelWorld'
import { MesherPool } from '../world/mesher/MesherPool'

/** three.js scene, lights + day cycle, iso camera, voxel chunks, and the `model` → `view` sync for entities. */
export class Renderer {
  readonly scene = new Scene()
  readonly renderer: WebGLRenderer
  readonly iso: IsoCamera
  readonly sun = new DirectionalLight()
  readonly ambient = new HemisphereLight()
  private grid?: GridHelper
  private axes?: AxesHelper
  private prev = new WeakMap<Entity, Transform>()
  private geometries = new Map<string, BoxGeometry>()
  private materials = new Map<string, MeshLambertMaterial>()
  private resizeObserver: ResizeObserver
  readonly atlas: BlockAtlas
  readonly chunks: ChunkRenderer
  readonly mesher = new MesherPool()

  constructor(
    private container: HTMLElement,
    private cfg: EngineConfig,
    private entities: Entities,
    world: VoxelWorld,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true })
    this.renderer.shadowMap.type = PCFShadowMap
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

    entities.world.onEntityRemoved.subscribe((e) => {
      if (e.view) e.view.removeFromParent()
    })

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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, render.maxPixelRatio))
    const sc = this.sun.shadow.camera
    sc.left = sc.bottom = -render.shadowRange
    sc.right = sc.top = render.shadowRange
    sc.updateProjectionMatrix()
    if (!light.dayCycle) {
      this.scene.background = new Color(render.background)
      this.sun.color.set(light.sunColor)
      this.sun.intensity = light.sunIntensity
      this.ambient.color.set(light.skyColor)
      this.ambient.groundColor.set(light.groundColor)
      this.ambient.intensity = light.ambientIntensity
    }
    const ao = render.ao
    const curve: [number, number, number, number] = [1 - ao * 0.75, 1 - ao * 0.5, 1 - ao * 0.25, 1]
    if (curve.some((v, i) => v !== this.chunks.aoCurve[i])) {
      this.chunks.aoCurve = curve
      this.chunks.remeshAll()
    }
    this.chunks.waterOpacity = render.waterOpacity
    this.chunks.setBorders(debug.showChunks)

    if (debug.showGrid && !this.grid) this.scene.add((this.grid = new GridHelper(256, 256, 0x335566, 0x557788)))
    if (!debug.showGrid && this.grid) (this.grid.removeFromParent(), (this.grid = undefined))
    if (debug.showAxes && !this.axes) this.scene.add((this.axes = new AxesHelper(4)))
    if (!debug.showAxes && this.axes) (this.axes.removeFromParent(), (this.axes = undefined))
    this.resize()
  }

  /** Engine system, start of each tick: remember transforms so rendering can interpolate. */
  snapshot(): void {
    for (const e of this.entities.world.with('transform')) {
      const p = this.prev.get(e)
      if (p) Object.assign(p, e.transform)
      else this.prev.set(e, { ...e.transform })
    }
  }

  render(ctx: TickContext): void {
    for (const e of this.entities.world.with('model')) {
      if (!e.view) {
        const view = this.createModel(e.model)
        this.scene.add(view)
        this.entities.world.addComponent(e, 'view', view)
      }
      const view = e.view!
      const t = e.transform
      if (!t) continue
      const p = this.prev.get(e) ?? t
      const a = ctx.alpha
      view.position.set(lerp(p.x, t.x, a), lerp(p.y, t.y, a), lerp(p.z, t.z, a))
      view.rotation.y = lerpAngle(p.rotY, t.rotY, a)
    }

    this.iso.update(ctx.dt)
    this.chunks.update(this.iso.target.x, this.iso.target.z)
    this.updateLight(ctx.dt)
    if (this.grid) this.grid.position.set(Math.round(this.iso.target.x), Math.round(this.iso.target.y) + 0.01, Math.round(this.iso.target.z))
    this.renderer.render(this.scene, this.iso.camera)
  }

  /** Box models for now; `.vox` loading arrives with stage 2. */
  createModel(spec: ModelSpec): Object3D {
    const [w, h, d] = spec.size
    const gKey = `${w}x${h}x${d}:${spec.anchor}`
    let geo = this.geometries.get(gKey)
    if (!geo) {
      geo = new BoxGeometry(w, h, d)
      if (spec.anchor === 'bottom') geo.translate(0, h / 2, 0)
      this.geometries.set(gKey, geo)
    }
    let mat = this.materials.get(spec.color)
    if (!mat) this.materials.set(spec.color, (mat = new MeshLambertMaterial({ color: spec.color })))
    const mesh = new Mesh(geo, mat)
    mesh.castShadow = mesh.receiveShadow = true
    return mesh
  }

  dispose(): void {
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
      const st = sampleLight(light.keys, light.time, light.sunAzimuth, light.maxElevation)
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
    const t = this.iso.target
    this.sun.target.position.copy(t)
    this.sun.position.set(t.x + 150 * dir[0], t.y + 150 * dir[1], t.z + 150 * dir[2])
  }

  private resize(): void {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    this.renderer.setSize(w, h, false)
    this.iso.resize(w, h)
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerpAngle = (a: number, b: number, t: number) => {
  const d = ((((b - a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI
  return a + d * t
}
