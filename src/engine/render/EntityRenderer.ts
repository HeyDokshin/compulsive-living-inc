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
  PlaneGeometry,
  SRGBColorSpace,
  type Object3D,
  type Scene,
} from 'three'
import type { Entities } from '../ecs/Entities'
import type { ModelLibrary } from '../models/ModelLibrary'
import type { Entity, ModelSpec, TickContext, Transform } from '../types'
import type { VoxelWorld } from '../world/VoxelWorld'
import { stylize } from './style'

/**
 * `model` component → three.js `view`, interpolated between simulation ticks.
 * Also draws optional silhouettes (visible through terrain) and soft blob shadows.
 */
export class EntityRenderer {
  private prev = new WeakMap<Entity, Transform>()
  private boxGeometries = new Map<string, BoxGeometry>()
  private boxMaterials = new Map<string, MeshLambertMaterial>()
  private silhouetteMaterials = new Map<string, MeshBasicMaterial>()
  private silhouetted = new WeakSet<Mesh>()
  /** Stencil-writing clones of entity materials, so silhouettes ignore the entity's own parts. */
  private stencilWriters = new WeakMap<Material, Material>()
  private blobs = new Map<Entity, Mesh>()
  private blobGeometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  private blobTexture = makeBlobTexture()

  constructor(
    private scene: Scene,
    private entities: Entities,
    private library: ModelLibrary,
    private world: VoxelWorld,
  ) {
    entities.world.onEntityRemoved.subscribe((e) => {
      e.view?.removeFromParent()
      const blob = this.blobs.get(e)
      if (blob) {
        blob.removeFromParent()
        ;(blob.material as MeshBasicMaterial).dispose()
        this.blobs.delete(e)
      }
    })
  }

  /** Start of each tick: remember transforms so rendering can interpolate. */
  snapshot(): void {
    for (const e of this.entities.world.with('transform')) {
      const p = this.prev.get(e)
      if (p) Object.assign(p, e.transform)
      else this.prev.set(e, { ...e.transform })
    }
  }

  private frame = 0

  render(ctx: TickContext): void {
    this.frame++
    const a = ctx.alpha
    for (const e of this.entities.world.with('model')) {
      if (!e.view) {
        const view = this.create(e.model)
        this.scene.add(view)
        this.entities.world.addComponent(e, 'view', view)
      }
      const view = e.view!
      const t = e.transform
      if (!t) continue
      const p = this.prev.get(e) ?? t
      view.position.set(lerp(p.x, t.x, a), lerp(p.y, t.y, a), lerp(p.z, t.z, a))
      view.rotation.y = lerpAngle(p.rotY, t.rotY, a)
      // Parts may load asynchronously; look for new meshes now and then, not every frame.
      if (e.silhouette && (this.frame + (e.uid ?? 0)) % 15 === 0) this.applySilhouette(view, e.silhouette)
      if (e.blobShadow) this.updateBlob(e, view)
    }
  }

  /** Recreate every view (models or rigs changed). */
  rebuildAll(): void {
    for (const e of [...this.entities.world.with('view')]) {
      e.view.removeFromParent()
      this.entities.world.removeComponent(e, 'view')
    }
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
      if (m.isMesh && !m.userData.silhouette && !this.silhouetted.has(m)) meshes.push(m)
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

  private updateBlob(e: Entity, view: Object3D): void {
    let blob = this.blobs.get(e)
    const s = e.blobShadow!
    if (!blob) {
      const mat = stylize(new MeshBasicMaterial({ map: this.blobTexture, transparent: true, depthWrite: false, opacity: s.opacity }))
      blob = new Mesh(this.blobGeometry, mat)
      blob.renderOrder = 1
      this.blobs.set(e, blob)
      this.scene.add(blob)
    }
    const x = view.position.x
    const z = view.position.z
    // ground under the entity: the first non-air cell at or below its feet
    let ground = 0
    for (let y = Math.floor(view.position.y + 0.01); y >= 0; y--) {
      if (this.world.get(Math.floor(x), y - 1, Math.floor(z))) {
        ground = y
        break
      }
    }
    const lift = Math.max(0, view.position.y - ground)
    blob.position.set(x, ground + 0.02, z)
    blob.scale.setScalar(s.radius * 2 * Math.max(0.5, 1 - lift * 0.3))
    ;(blob.material as MeshBasicMaterial).opacity = s.opacity * Math.max(0.2, 1 - lift * 0.5)
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

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerpAngle = (a: number, b: number, t: number) => {
  const d = ((((b - a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI
  return a + d * t
}
