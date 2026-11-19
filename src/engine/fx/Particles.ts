import { BoxGeometry, Color, DynamicDrawUsage, Euler, InstancedMesh, Matrix4, MeshBasicMaterial, MeshLambertMaterial, Quaternion, Vector3, type Scene } from 'three'
import type { Registry } from '../registry/Registry'
import { stylize } from '../render/style'
import type { ParticleDef } from './defs'
import { createLogger } from '../util/log'

const log = createLogger('fx')

export interface BurstOptions {
  /** Use this color for every particle (e.g. the color of the dug block). */
  color?: string
  /** Multiply the preset's count. */
  amount?: number
  /** Multiply sizes. */
  scale?: number
}

/** Pooled voxel particles drawn with two instanced meshes (shaded and glowing). */
export class Particles {
  private max: number
  private alive = 0
  private pos: Float32Array
  private vel: Float32Array
  private rot: Float32Array
  private info: Float32Array // size, life, age, spin, gravity, drag, shrink(0/1), glow(0/1)
  private col: Float32Array
  private lit: InstancedMesh
  private glow: InstancedMesh
  private m = new Matrix4()
  private q = new Quaternion()
  private e = new Euler()
  private v = new Vector3()
  private s = new Vector3()
  private c = new Color()

  constructor(
    scene: Scene,
    private presets: Registry<ParticleDef>,
    max = 2048,
  ) {
    this.max = max
    this.pos = new Float32Array(max * 3)
    this.vel = new Float32Array(max * 3)
    this.rot = new Float32Array(max * 3)
    this.info = new Float32Array(max * 8)
    this.col = new Float32Array(max * 3)
    const geo = new BoxGeometry(1, 1, 1)
    this.lit = new InstancedMesh(geo, stylize(new MeshLambertMaterial()), max)
    this.glow = new InstancedMesh(geo, stylize(new MeshBasicMaterial({ transparent: true, opacity: 0.95 })), max)
    for (const mesh of [this.lit, this.glow]) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage)
      mesh.setColorAt(0, new Color(1, 1, 1))
      mesh.count = 0
      mesh.frustumCulled = false
      scene.add(mesh)
    }
    this.lit.castShadow = true
  }

  burst(id: string, at: { x: number; y: number; z: number }, opts: BurstOptions = {}): void {
    const def = this.presets.get(id)
    if (!def) {
      log.warn(`unknown particle preset "${id}"`)
      return
    }
    const n = Math.round(def.count * (opts.amount ?? 1))
    const rnd = (r: [number, number]) => r[0] + Math.random() * (r[1] - r[0])
    for (let k = 0; k < n && this.alive < this.max; k++) {
      const i = this.alive++
      const a = Math.random() * Math.PI * 2
      const rr = Math.sqrt(Math.random()) * def.radius
      this.pos.set([at.x + Math.cos(a) * rr, at.y, at.z + Math.sin(a) * rr], i * 3)
      const tilt = Math.random() * def.spread
      const dir = Math.random() * Math.PI * 2
      const sp = rnd(def.speed)
      this.vel.set([Math.sin(tilt) * Math.cos(dir) * sp, Math.cos(tilt) * sp, Math.sin(tilt) * Math.sin(dir) * sp], i * 3)
      this.rot.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3)
      this.info.set([rnd(def.size) * (opts.scale ?? 1), rnd(def.life), 0, def.spin * (Math.random() * 2 - 1), def.gravity, def.drag, def.shrink ? 1 : 0, def.glow ? 1 : 0], i * 8)
      this.c.set(opts.color ?? def.colors[Math.floor(Math.random() * def.colors.length)] ?? '#ffffff')
      this.col.set([this.c.r, this.c.g, this.c.b], i * 3)
    }
  }

  update(dt: number): void {
    // integrate and compact (swap-remove dead particles)
    let i = 0
    while (i < this.alive) {
      const o = i * 8
      this.info[o + 2]! += dt
      if (this.info[o + 2]! >= this.info[o + 1]!) {
        this.kill(i)
        continue
      }
      const damp = Math.max(0, 1 - this.info[o + 5]! * dt)
      this.vel[i * 3 + 1]! -= this.info[o + 4]! * dt
      for (let k = 0; k < 3; k++) {
        this.vel[i * 3 + k]! *= damp
        this.pos[i * 3 + k]! += this.vel[i * 3 + k]! * dt
        this.rot[i * 3 + k]! += this.info[o + 3]! * dt
      }
      i++
    }
    let nl = 0
    let ng = 0
    for (let p = 0; p < this.alive; p++) {
      const o = p * 8
      const t = this.info[o + 2]! / this.info[o + 1]!
      const size = this.info[o]! * (this.info[o + 6] ? 1 - t * t : 1)
      this.e.set(this.rot[p * 3]!, this.rot[p * 3 + 1]!, this.rot[p * 3 + 2]!)
      this.q.setFromEuler(this.e)
      this.v.set(this.pos[p * 3]!, this.pos[p * 3 + 1]!, this.pos[p * 3 + 2]!)
      this.s.setScalar(Math.max(0.0001, size))
      this.m.compose(this.v, this.q, this.s)
      this.c.setRGB(this.col[p * 3]!, this.col[p * 3 + 1]!, this.col[p * 3 + 2]!)
      const mesh = this.info[o + 7] ? this.glow : this.lit
      const idx = this.info[o + 7] ? ng++ : nl++
      mesh.setMatrixAt(idx, this.m)
      mesh.setColorAt(idx, this.c)
    }
    for (const [mesh, n] of [[this.lit, nl], [this.glow, ng]] as const) {
      mesh.count = n
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  get count(): number {
    return this.alive
  }

  private kill(i: number): void {
    const last = --this.alive
    if (i === last) return
    this.pos.copyWithin(i * 3, last * 3, last * 3 + 3)
    this.vel.copyWithin(i * 3, last * 3, last * 3 + 3)
    this.rot.copyWithin(i * 3, last * 3, last * 3 + 3)
    this.col.copyWithin(i * 3, last * 3, last * 3 + 3)
    this.info.copyWithin(i * 8, last * 8, last * 8 + 8)
  }
}
