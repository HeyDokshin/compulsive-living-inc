import {
  BoxGeometry,
  CanvasTexture,
  AlwaysStencilFunc,
  GreaterDepth,
  KeepStencilOp,
  Mesh,
  NotEqualStencilFunc,
  ReplaceStencilOp,
  type Material,
  MeshBasicMaterial,
  MeshLambertMaterial,
  SRGBColorSpace,
  type Object3D,
  type Scene,
} from 'three'
import type { Entities } from '../ecs/Entities'
import type { ModelLibrary } from '../models/ModelLibrary'
import type { Entity, ModelSpec, TickContext, Transform } from '../types'
import type { VoxelWorld } from '../world/VoxelWorld'
import { BlobBatch, ModelBatches } from './Batches'
import { stylize } from './style'

/**
 * `model` component → three.js `view`, interpolated between simulation ticks.
 * Things outside the picture are hidden; `instanced` models and soft blob shadows are drawn in batches.
 * Also draws optional silhouettes (visible through terrain).
 */
export class EntityRenderer {
  private prev = new WeakMap<Entity, Transform>()
  private boxGeometries = new Map<string, BoxGeometry>()
  private boxMaterials = new Map<string, MeshLambertMaterial>()
  private silhouetteMaterials = new Map<string, MeshBasicMaterial>()
  private silhouetted = new WeakSet<Mesh>()
  /** Stencil-writing clones of entity materials, so silhouettes ignore the entity's own parts. */
  private stencilWriters = new WeakMap<Material, Material>()
  private models: ReturnType<typeof modelQuery>
  private placed: ReturnType<typeof placedQuery>
  private blobs: BlobBatch
  private batches: ModelBatches

  constructor(
    private scene: Scene,
    private entities: Entities,
    private library: ModelLibrary,
    private world: VoxelWorld,
  ) {
    this.models = modelQuery(entities)
    this.placed = placedQuery(entities)
    this.blobs = new BlobBatch(scene, makeBlobTexture())
    this.batches = new ModelBatches(scene, library)
    entities.world.onEntityRemoved.subscribe((e) => e.view?.removeFromParent())
  }

  /** Start of each tick: remember transforms so rendering can interpolate. */
  snapshot(): void {
    for (const e of this.placed) {
      const p = this.prev.get(e)
      if (p) Object.assign(p, e.transform)
      else this.prev.set(e, { ...e.transform })
    }
  }

  private frame = 0
  /** Is an entity at (x, z) drawn? (inside an interior only its room is) */
  visibleAt: (x: number, z: number) => boolean = () => true
  /** Can a ball show up in the picture? (set by the Renderer from the camera) */
  inView: (x: number, y: number, z: number, r: number) => boolean = () => true

  render(ctx: TickContext): void {
    this.frame++
    const a = ctx.alpha
    this.batches.begin()
    this.blobs.begin()
    for (const e of this.models) {
      const spec = e.model
      const batched = spec.instanced === true && spec.shape !== 'box' && spec.ref !== undefined
      if (!e.view && !batched) {
        const view = this.create(spec)
        this.scene.add(view)
        this.entities.world.addComponent(e, 'view', view)
      }
      const t = e.transform
      if (!t) continue
      const p = this.prev.get(e) ?? t
      const x = lerp(p.x, t.x, a)
      const y = lerp(p.y, t.y, a)
      const z = lerp(p.z, t.z, a)
      const rotY = lerpAngle(p.rotY, t.rotY, a)
      const b = e.blocker
      const r = b ? Math.max(DEFAULT_RADIUS, ((b.w ?? 1) + (b.d ?? 1)) / 2 + (b.h ?? 3)) : DEFAULT_RADIUS
      const visible = this.visibleAt(t.x, t.z) && this.inView(x, y, z, r)
      const view = e.view
      if (view) {
        view.position.set(x, y, z)
        view.rotation.y = rotY
        view.visible = visible
      }
      if (!visible) continue
      if (batched) this.batches.place(spec, x, y, z, rotY)
      // Parts may load asynchronously; look for new meshes now and then, not every frame.
      if (view && e.silhouette && (this.frame + (e.uid ?? 0)) % 15 === 0) this.applySilhouette(view, e.silhouette)
      if (e.blobShadow) this.blob(e.blobShadow, x, y, z)
    }
    this.batches.end()
    this.blobs.end()
  }

  /** Recreate one entity's view (its `model` changed, e.g. new clothes). */
  refresh(e: Entity): void {
    if (!e.view) return
    e.view.removeFromParent()
    this.entities.world.removeComponent(e, 'view')
  }

  /** Recreate every view (models or rigs changed). */
  rebuildAll(): void {
    for (const e of [...this.entities.world.with('view')]) {
      e.view.removeFromParent()
      this.entities.world.removeComponent(e, 'view')
    }
    this.batches.clear()
  }

  create(spec: ModelSpec): Object3D {
    if (spec.shape === 'voxel' && spec.ref) return this.library.createVoxel(spec.ref, spec)
    if (spec.shape === 'rig' && spec.ref) return this.library.createRig(spec.ref, spec)
    const [w, h, d] = spec.size
    const gKey = `${w}x${h}x${d}:${spec.anchor}`
    let geo = this.boxGeometries.get(gKey)
    if (!geo) {
      geo = new BoxGeometry(w, h, d)
      if (spec.anchor === 'bottom') geo.translate(0, h / 2, 0)
      this.boxGeometries.set(gKey, geo)
    }
    let mat = this.boxMaterials.get(spec.color)
    if (!mat) this.boxMaterials.set(spec.color, (mat = stylize(new MeshLambertMaterial({ color: spec.color }))))
    const mesh = new Mesh(geo, mat)
    mesh.castShadow = mesh.receiveShadow = true
    return mesh
  }

  /** A see-through copy of each mesh drawn only where the real one is hidden (depth test inverted). */
  private applySilhouette(view: Object3D, s: { color: string; opacity: number }): void {
    const key = `${s.color}:${s.opacity}`
    let mat = this.silhouetteMaterials.get(key)
    if (!mat) {
      mat = stylize(
        new MeshBasicMaterial({
          color: s.color,
          transparent: true,
          opacity: s.opacity,
          depthFunc: GreaterDepth,
          depthWrite: false,
          // only where the entity itself was not drawn (stencil != 1)
          stencilWrite: true,
          stencilRef: 1,
          stencilFunc: NotEqualStencilFunc,
          stencilFail: KeepStencilOp,
          stencilZFail: KeepStencilOp,
          stencilZPass: KeepStencilOp,
        }),
      )
      this.silhouetteMaterials.set(key, mat)
    }
    const meshes: Mesh[] = []
    view.traverse((o) => {
      const m = o as Mesh
      if (m.isMesh && !m.userData.silhouette && !m.userData.fur && !this.silhouetted.has(m)) meshes.push(m)
    })
    for (const m of meshes) {
      this.silhouetted.add(m)
      m.material = this.stencilWriter(m.material as Material)
      const ghost = new Mesh(m.geometry, mat)
      ghost.userData.silhouette = true
      ghost.renderOrder = 10
      m.add(ghost)
    }
  }

  private stencilWriter(base: Material): Material {
    let m = this.stencilWriters.get(base)
    if (!m) {
      m = base.clone()
      m.onBeforeCompile = base.onBeforeCompile
      m.customProgramCacheKey = base.customProgramCacheKey
      m.stencilWrite = true
      m.stencilRef = 1
      m.stencilFunc = AlwaysStencilFunc
      m.stencilZPass = ReplaceStencilOp
      this.stencilWriters.set(base, m)
    }
    return m
  }

  /** A soft round shadow on the ground under (x, y, z). */
  private blob(s: { radius: number; opacity: number }, x: number, y: number, z: number): void {
    // ground under the entity: the first non-air cell at or below its feet
    let ground = 0
    for (let gy = Math.floor(y + 0.01); gy >= 0; gy--) {
      if (this.world.get(Math.floor(x), gy - 1, Math.floor(z))) {
        ground = gy
        break
      }
    }
    const lift = Math.max(0, y - ground)
    this.blobs.push(x, ground + 0.02, z, s.radius * 2 * Math.max(0.5, 1 - lift * 0.3), s.opacity * Math.max(0.2, 1 - lift * 0.5))
  }
}

function makeBlobTexture(): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(60,40,80,1)')
  grad.addColorStop(0.55, 'rgba(60,40,80,0.6)')
  grad.addColorStop(1, 'rgba(60,40,80,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

/** Radius (blocks) an entity without a footprint takes up for culling: a tree with its canopy fits. */
const DEFAULT_RADIUS = 3.5

const placedQuery = (entities: Entities) => entities.world.with('transform')
const modelQuery = (entities: Entities) => entities.world.with('model')

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerpAngle = (a: number, b: number, t: number) => {
  const d = ((((b - a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI
  return a + d * t
}
