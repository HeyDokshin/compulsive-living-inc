/**
 * Decorative flora: grass tufts and little flowers scattered on lawns, gently swaying.
 * Purely cosmetic (no interaction yet — picking/planting flowers comes with the nature stage).
 *
 * Shows: a worldgen step that reads the 2D maps of `terrain`, instanced rendering, custom
 * materials with the game look (`api.render.stylize` with sway), and reacting to block edits.
 */
import { definePlugin, z, type PluginApi } from '@sdk'

const Config = z.object({
  tuftDensity: z.number().min(0).max(1).default(0.16).meta({ label: 'tuft density', step: 0.01 }),
  flowerDensity: z.number().min(0).max(0.5).default(0.07).meta({ label: 'flower density', step: 0.005 }),
  clusterScale: z.number().min(0.01).max(0.5).default(0.09).meta({ label: 'cluster scale', step: 0.005 }),
  sway: z.number().min(0).max(0.5).default(0.12).meta({ step: 0.01 }),
  /** Surface blocks flora grows on. */
  growsOn: z.string().default('#core:flora_soil'),
  tuftColor: z.string().default('#a5dd7c').meta({ color: true }),
  stemColor: z.string().default('#7cc35c').meta({ color: true }),
  flowerColors: z.array(z.string()).default(['#ffffff', '#ffc4dc', '#fff19e', '#dccbff', '#ffbfae', '#bfe6ff']),
})
type Config = z.infer<typeof Config>

/** One plant: column position, height it stands on, rotation, scale, color index. */
interface Plant {
  x: number
  y: number
  z: number
  rot: number
  scale: number
  color: number
}

export default definePlugin({
  id: 'flora',
  version: '0.1.0',
  description: 'Декоративная трава и цветы на газонах',
  dependsOn: ['terrain'],

  setup(api) {
    const cfg = api.config.define(Config)
    let tufts: Plant[] = []
    let flowers: Plant[] = []

    api.registry('worldgen').register({
      id: 'flora:scatter',
      order: 500,
      description: 'Scatter grass tufts and flowers on lawns',
      run: (ctx) => {
        tufts = []
        flowers = []
        const rng = ctx.rng('flora')
        const tuftField = ctx.noise('flora-tufts')
        const flowerField = ctx.noise('flora-flowers')
        const soil = new Set(api.registry('blocks').resolve(cfg.growsOn).map((b) => b.id))
        const s = cfg.clusterScale
        for (let z = 0; z < ctx.sizeZ; z++) {
          for (let x = 0; x < ctx.sizeX; x++) {
            const i = ctx.index(x, z)
            if (!soil.has(ctx.surface[i]!) || ctx.waterMap[i]! > ctx.heightMap[i]!) continue
            const y = ctx.heightMap[i]!
            const tuftChance = cfg.tuftDensity * (0.35 + Math.max(0, tuftField(x * s, z * s)) * 1.6)
            if (rng() < tuftChance) {
              tufts.push({ x: x + 0.2 + rng() * 0.6, y, z: z + 0.2 + rng() * 0.6, rot: rng() * Math.PI * 2, scale: 0.8 + rng() * 0.5, color: 0 })
            }
            const flowerChance = cfg.flowerDensity * Math.max(0, flowerField(x * s * 1.3, z * s * 1.3) * 2.4 - 0.2)
            if (rng() < flowerChance) {
              // Flowers come in little patches of one color.
              const color = Math.floor((flowerField(x * 0.02 + 40, z * 0.02) * 0.5 + 0.5) * cfg.flowerColors.length) % cfg.flowerColors.length
              flowers.push({ x: x + 0.25 + rng() * 0.5, y, z: z + 0.25 + rng() * 0.5, rot: rng() * Math.PI * 2, scale: 1.15 + rng() * 0.4, color })
            }
          }
        }
      },
    })

    const view = new FloraView(api, cfg)
    /** Columns with plants on them: most block edits (rooms are built out of thousands) touch none. */
    const planted = new Set<number>()
    const cell = (x: number, z: number) => Math.floor(x) * 65536 + Math.floor(z)
    const rebuild = () => {
      planted.clear()
      for (const p of tufts) planted.add(cell(p.x, p.z))
      for (const p of flowers) planted.add(cell(p.x, p.z))
      view.build(tufts, flowers)
    }
    let dirty = false
    api.systems.add({
      id: 'rebuild',
      outdoors: true, // the island waits while you're in a room
      phase: 'render',
      run: () => {
        if (!dirty) return
        dirty = false
        rebuild()
      },
    })
    api.events.on('world:generated', rebuild)
    api.events.on('interior:changed', ({ id }) => view.setVisible(!id))
    // Plants are generated with the island; saves keep them (so dug/removed ones stay gone).
    api.save.register<{ tufts: Plant[]; flowers: Plant[] }>({
      version: 1,
      save: () => ({ tufts, flowers }),
      load: (data) => {
        tufts = data.tufts
        flowers = data.flowers
        rebuild()
      },
    })
    api.config.onChange(() => api.world.regenerateSoon())

    // Digging or building on a column removes the plants there.
    api.events.on('world:blockChanged', ({ x, z }) => {
      if (!planted.delete(cell(x, z))) return
      const keep = (p: Plant) => Math.floor(p.x) !== x || Math.floor(p.z) !== z
      tufts = tufts.filter(keep)
      flowers = flowers.filter(keep)
      dirty = true // however many edits this frame: one rebuild
    })

    api.commands.register({
      name: 'flora',
      description: 'Сколько травинок и цветов на острове',
      run: () => `tufts ${tufts.length}, flowers ${flowers.length}`,
    })
  },
})

type THREE = PluginApi['render']['three']
type Mesh = InstanceType<THREE['InstancedMesh']>

class FloraView {
  private meshes: Mesh[] = []
  private THREE: THREE

  constructor(
    private api: PluginApi,
    private cfg: Config,
  ) {
    this.THREE = api.render.three
    api.onDispose(() => this.clear())
  }

  build(tufts: Plant[], flowers: Plant[]): void {
    this.clear()
    const T = this.THREE
    const material = () => this.api.render.stylize(new T.MeshLambertMaterial({ vertexColors: true }), { sway: this.cfg.sway })

    this.add(this.tuftGeometry(), material(), tufts, () => undefined)
    this.add(this.stemGeometry(), material(), flowers, () => undefined)
    const colors = this.cfg.flowerColors.map((c) => new T.Color(c))
    this.add(this.blossomGeometry(), material(), flowers, (p) => colors[p.color] ?? colors[0])
  }

  private add(geo: NonNullable<ConstructorParameters<THREE['InstancedMesh']>[0]>, mat: InstanceType<THREE['Material']>, plants: Plant[], color: (p: Plant) => InstanceType<THREE['Color']> | undefined): void {
    if (!plants.length) {
      geo.dispose()
      mat.dispose()
      return
    }
    const T = this.THREE
    const mesh = new T.InstancedMesh(geo, mat, plants.length)
    const m = new T.Matrix4()
    const q = new T.Quaternion()
    const up = new T.Vector3(0, 1, 0)
    plants.forEach((p, i) => {
      q.setFromAxisAngle(up, p.rot)
      m.compose(new T.Vector3(p.x, p.y, p.z), q, new T.Vector3(p.scale, p.scale, p.scale))
      mesh.setMatrixAt(i, m)
      const c = color(p)
      if (c) mesh.setColorAt(i, c)
    })
    mesh.receiveShadow = true
    mesh.castShadow = false
    mesh.frustumCulled = false
    mesh.visible = !this.api.interiors.current // island decoration: hidden indoors
    this.api.render.add(mesh)
    this.meshes.push(mesh)
  }

  setVisible(v: boolean): void {
    for (const m of this.meshes) m.visible = v
  }

  private clear(): void {
    for (const m of this.meshes) {
      m.removeFromParent()
      m.geometry.dispose()
      ;(m.material as InstanceType<THREE['Material']>).dispose()
      m.dispose()
    }
    this.meshes = []
  }

  /** Merge boxes into one geometry with per-vertex colors (bottom of each box a bit darker). */
  private boxes(parts: Array<{ size: [number, number, number]; at: [number, number, number]; tilt?: [number, number]; color: string; shadeBottom?: number }>) {
    const T = this.THREE
    const pos: number[] = []
    const nor: number[] = []
    const col: number[] = []
    const idx: number[] = []
    const tmp = new T.Color()
    for (const part of parts) {
      const g = new T.BoxGeometry(...part.size)
      g.translate(0, part.size[1] / 2, 0)
      const r = new T.Matrix4().makeRotationFromEuler(new T.Euler(part.tilt?.[0] ?? 0, 0, part.tilt?.[1] ?? 0))
      g.applyMatrix4(r)
      g.translate(...part.at)
      const p = g.getAttribute('position')
      const n = g.getAttribute('normal')
      const base = pos.length / 3
      tmp.set(part.color)
      for (let i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i))
        nor.push(n.getX(i), n.getY(i), n.getZ(i))
        const low = p.getY(i) - part.at[1] < part.size[1] * 0.5
        const k = low ? (part.shadeBottom ?? 1) : 1
        col.push(tmp.r * k, tmp.g * k, tmp.b * k)
      }
      for (const v of g.getIndex()!.array) idx.push(base + v)
      g.dispose()
    }
    const geo = new T.BufferGeometry()
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3))
    geo.setAttribute('normal', new T.Float32BufferAttribute(nor, 3))
    geo.setAttribute('color', new T.Float32BufferAttribute(col, 3))
    geo.setIndex(idx)
    return geo
  }

  private tuftGeometry() {
    const c = this.cfg.tuftColor
    return this.boxes([
      { size: [0.06, 0.26, 0.06], at: [0, 0, 0], tilt: [0.1, 0.25], color: c, shadeBottom: 0.75 },
      { size: [0.06, 0.32, 0.06], at: [0.06, 0, 0.03], tilt: [-0.08, -0.15], color: c, shadeBottom: 0.75 },
      { size: [0.06, 0.22, 0.06], at: [-0.05, 0, 0.05], tilt: [0.25, -0.05], color: c, shadeBottom: 0.75 },
    ])
  }

  private stemGeometry() {
    return this.boxes([
      { size: [0.05, 0.3, 0.05], at: [0, 0, 0], color: this.cfg.stemColor, shadeBottom: 0.75 },
      { size: [0.12, 0.03, 0.06], at: [0.06, 0.1, 0], color: this.cfg.stemColor },
    ])
  }

  /** Four round-ish petals around a warm center; tinted per instance. */
  private blossomGeometry() {
    const white = '#ffffff'
    const y = 0.3
    return this.boxes([
      { size: [0.1, 0.06, 0.1], at: [0.09, y, 0], color: white },
      { size: [0.1, 0.06, 0.1], at: [-0.09, y, 0], color: white },
      { size: [0.1, 0.06, 0.1], at: [0, y, 0.09], color: white },
      { size: [0.1, 0.06, 0.1], at: [0, y, -0.09], color: white },
      { size: [0.08, 0.08, 0.08], at: [0, y + 0.01, 0], color: '#ffe08a' },
    ])
  }
}
