import { type BufferAttribute, InstancedBufferAttribute, InstancedMesh, MeshBasicMaterial, PlaneGeometry, type BufferGeometry, type Material, type Object3D, type Texture } from 'three'
import type { ModelLibrary } from '../models/ModelLibrary'
import type { ModelSpec } from '../types'
import { stylize } from './style'

const START = 32
const HERE = [0, 0, 0] as const

/** An instanced mesh that grows, and uploads only when something in it really changed. */
class Instances {
  mesh: InstancedMesh
  private slots = new Float32Array(START * 6)
  private n = 0
  private dirty = false

  constructor(
    private parent: Object3D,
    private geometry: BufferGeometry,
    private material: Material,
    private setup: (mesh: InstancedMesh, capacity: number) => void,
  ) {
    this.mesh = this.create(START)
  }

  begin(): void {
    this.n = 0
  }

  /** Put the next instance at (x, y, z), turned around y, scaled; `extra` = any per-instance number. */
  push(x: number, y: number, z: number, rotY: number, scale: number, extra = 0): void {
    const i = this.n++
    if (i >= this.mesh.instanceMatrix.count) this.grow()
    const s = this.slots
    const o = i * 6
    if (s[o] === Math.fround(x) && s[o + 1] === Math.fround(y) && s[o + 2] === Math.fround(z) && s[o + 3] === Math.fround(rotY) && s[o + 4] === Math.fround(scale) && s[o + 5] === Math.fround(extra)) return
    s[o] = x
    s[o + 1] = y
    s[o + 2] = z
    s[o + 3] = rotY
    s[o + 4] = scale
    s[o + 5] = extra
    this.dirty = true
    const m = this.mesh.instanceMatrix.array
    const c = Math.cos(rotY) * scale
    const k = Math.sin(rotY) * scale
    const p = i * 16
    m[p] = c
    m[p + 2] = -k
    m[p + 5] = scale
    m[p + 8] = k
    m[p + 10] = c
    m[p + 12] = x
    m[p + 13] = y
    m[p + 14] = z
    m[p + 15] = 1
    const alpha = this.mesh.geometry.getAttribute('aAlpha')
    if (alpha) alpha.setX(i, extra)
  }

  end(): void {
    this.mesh.count = this.n
    this.mesh.visible = this.n > 0
    if (!this.dirty) return
    this.dirty = false
    this.mesh.instanceMatrix.needsUpdate = true
    const alpha = this.mesh.geometry.getAttribute('aAlpha')
    if (alpha) alpha.needsUpdate = true
  }

  dispose(): void {
    this.mesh.removeFromParent()
    this.mesh.dispose()
  }

  private create(capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(this.geometry, this.material, capacity)
    mesh.instanceMatrix.array.fill(0)
    mesh.frustumCulled = false // the entity renderer only hands over what is in view
    this.setup(mesh, capacity)
    this.parent.add(mesh)
    return mesh
  }

  private grow(): void {
    const old = this.mesh
    const alpha = this.geometry.getAttribute('aAlpha') as BufferAttribute | undefined
    const capacity = old.instanceMatrix.count * 2
    this.mesh = this.create(capacity)
    ;(this.mesh.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array as Float32Array)
    old.removeFromParent()
    old.dispose()
    const alphaNow = this.mesh.geometry.getAttribute('aAlpha') as BufferAttribute | undefined
    if (alpha && alphaNow) (alphaNow.array as Float32Array).set(alpha.array as Float32Array)
    // the next frame writes everything again
    this.slots = new Float32Array(capacity * 6).fill(NaN)
    this.dirty = true
  }
}

/** One instanced geometry of a model: a voxel model has one, a rig one per part. */
interface Piece {
  batch: Instances
  scale: number
  /** Offset from the entity before turning. */
  x: number
  y: number
  z: number
}

/** Entities whose model says `instanced`: one draw call per model and palette, however many there are. */
export class ModelBatches {
  private byKey = new Map<string, Instances>()
  /** What each model spec is made of (specs are replaced, not edited); pieces join as their models load. */
  private bySpec = new WeakMap<ModelSpec, Piece[]>()
  /** Bumps on clear: models that arrive late from before are dropped. */
  private epoch = 0

  constructor(
    private parent: Object3D,
    private library: ModelLibrary,
  ) {}

  begin(): void {
    for (const b of this.byKey.values()) b.begin()
  }

  place(spec: ModelSpec, x: number, y: number, z: number, rotY: number): void {
    let pieces = this.bySpec.get(spec)
    if (!pieces) this.bySpec.set(spec, (pieces = this.load(spec)))
    if (!pieces.length) return
    const c = Math.cos(rotY)
    const s = Math.sin(rotY)
    for (const p of pieces) p.batch.push(x + c * p.x + s * p.z, y + p.y, z - s * p.x + c * p.z, rotY, p.scale)
  }

  private load(spec: ModelSpec): Piece[] {
    const pieces: Piece[] = []
    const epoch = this.epoch
    const add = (geo: BufferGeometry, scale: number, key: string, at: readonly [number, number, number], material: Material) => {
      if (epoch !== this.epoch) return
      let batch = this.byKey.get(key)
      if (!batch) {
        batch = new Instances(this.parent, geo, material, (mesh) => {
          mesh.castShadow = true
          mesh.receiveShadow = true
        })
        this.byKey.set(key, batch)
      }
      pieces.push({ batch, scale, x: at[0], y: at[1], z: at[2] })
    }
    if (spec.shape === 'rig') this.library.rigGeometry(spec.ref!, spec, add)
    else this.library.voxelGeometry(spec.ref!, spec.palette, (geo, scale, key, material) => add(geo, spec.scale ?? scale, key, HERE, material))
    return pieces
  }

  end(): void {
    for (const b of this.byKey.values()) b.end()
  }

  /** Forget everything (models changed). */
  clear(): void {
    this.epoch++
    for (const b of this.byKey.values()) b.dispose()
    this.byKey.clear()
    this.bySpec = new WeakMap()
  }
}

/** Soft round shadows under characters and things, all in one draw call. */
export class BlobBatch {
  private instances: Instances

  constructor(parent: Object3D, texture: Texture) {
    const material = new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aAlpha;\nvarying float vAlpha;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vAlpha;')
    }
    material.customProgramCacheKey = () => 'blob'
    this.instances = new Instances(parent, new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), stylize(material), (mesh, capacity) => {
      mesh.renderOrder = 1
      mesh.geometry.setAttribute('aAlpha', new InstancedBufferAttribute(new Float32Array(capacity), 1))
    })
  }

  begin(): void {
    this.instances.begin()
  }

  push(x: number, y: number, z: number, size: number, alpha: number): void {
    this.instances.push(x, y, z, 0, size, alpha)
  }

  end(): void {
    this.instances.end()
  }
}
