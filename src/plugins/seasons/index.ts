/**
 * The seasons on the ground: snow lies on the island in winter and the water freezes from the banks,
 * leaves fall and lie about in autumn, petals drift in spring. How much of each, month by month, is
 * config; the look is the engine's ground and water shaders (`api.render.setCover`) and a handful of
 * falling leaves or petals around the camera (one instanced draw).
 */
import { definePlugin, z, type PluginApi } from '@sdk'
import { monthly } from './cover'

declare module '@sdk' {
  interface GameEvents {
    /** The season's cover changed (0…1 each): what lies on the island now. */
    'seasons:cover': { snow: number; ice: number; litter: number }
  }
}

const Month = z.array(z.number().min(0).max(1)).length(12)

const Config = z.object({
  /** Month by month (January first; the south turns it round): snow on the ground, ice on the water,
   * fallen leaves or petals lying about, and how many fall through the air around you. */
  snow: Month.default([0.95, 0.8, 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0.5]),
  ice: Month.default([0.85, 0.7, 0.1, 0, 0, 0, 0, 0, 0, 0, 0, 0.3]),
  litter: Month.default([0, 0, 0, 0.35, 0.15, 0, 0, 0, 0.15, 0.6, 0.75, 0.15]),
  falling: Month.default([0, 0, 0, 0.5, 0.3, 0, 0, 0, 0.3, 0.9, 1, 0.15]),
  /** While it snows the snow lies thicker by up to this much. */
  snowfall: z.number().min(0).max(1).default(0.3).meta({ step: 0.05 }),
  /** Colors of what lies about and falls: petals in spring, leaves the rest of the year. */
  petals: z.tuple([z.string(), z.string()]).default(['#ffc4d6', '#fff2f5']),
  leaves: z.tuple([z.string(), z.string()]).default(['#d9602a', '#f2b03a']),
  /** The most leaves in the air at once, how far around the camera, how big, how fast they fall. */
  maxFalling: z.number().int().min(0).max(400).default(70).meta({ label: 'max falling', step: 1 }),
  radius: z.number().min(4).max(40).default(14).meta({ step: 1 }),
  size: z.number().min(0.05).max(1).default(0.22).meta({ step: 0.01 }),
  fallSpeed: z.number().min(0.1).max(5).default(0.7).meta({ label: 'fall speed', step: 0.05 }),
})
type Config = z.infer<typeof Config>

export default definePlugin({
  id: 'seasons',
  version: '0.1.0',
  description: 'Сезоны на земле: снег и лёд зимой, листопад осенью, лепестки весной',
  optionalDependsOn: ['weather'],

  setup(api) {
    const cfg = api.config.define(Config)
    const falling = new Falling(api, cfg)
    let snowing = 0
    let check = 0
    /** Cover now (0…1 each), worked out a few times a second: it changes over days. */
    const now = { snow: 0, ice: 0, litter: 0, falling: 0 }
    const work = () => {
      const d = api.time.now()
      const south = api.engineConfig.time.hemisphere === 'south'
      const w = api.services.has('weather:forecast') ? api.services.get('weather:forecast').current() : undefined
      snowing = w?.precipitation === 'snow' ? w.intensity : 0
      now.snow = Math.min(1, monthly(cfg.snow, d.month, d.day, south) + (monthly(cfg.snow, d.month, d.day, south) > 0 ? snowing * cfg.snowfall : 0))
      now.ice = monthly(cfg.ice, d.month, d.day, south)
      now.litter = monthly(cfg.litter, d.month, d.day, south)
      now.falling = monthly(cfg.falling, d.month, d.day, south)
      const spring = api.time.season === 'spring'
      const inside = api.interiors.current !== null
      // rooms have floors of their own: nothing lies on them
      api.render.setCover({
        snow: inside ? 0 : now.snow,
        ice: inside ? 0 : now.ice,
        litter: inside ? 0 : now.litter,
        litterColors: spring ? cfg.petals : cfg.leaves,
      })
      falling.set(inside ? 0 : Math.round(now.falling * cfg.maxFalling), spring ? cfg.petals : cfg.leaves)
      tell(now.snow, now.ice, now.litter)
    }
    // others (grass and flowers going under the snow) hear when it changes enough to show
    const told = { snow: -1, ice: -1, litter: -1 }
    const tell = (snow: number, ice: number, litter: number) => {
      if (Math.abs(snow - told.snow) < 0.02 && Math.abs(ice - told.ice) < 0.02 && Math.abs(litter - told.litter) < 0.02) return
      Object.assign(told, { snow, ice, litter })
      api.events.emit('seasons:cover', { snow, ice, litter })
    }
    api.systems.add({
      id: 'seasons',
      phase: 'render',
      run: ({ dt }) => {
        if ((check -= dt) <= 0) {
          check = 0.5
          work()
        }
        falling.update(dt)
      },
    })
    api.events.on('interior:changed', () => void (check = 0))
    api.events.on('session:started', () => void (check = 0))
    api.config.onChange(() => void (check = 0))
    api.onDispose(() => api.render.setCover({ snow: 0, ice: 0, litter: 0 }))

    api.commands.register({
      name: 'seasons',
      description: 'Сезоны на земле: seasons (сейчас) · seasons <месяц 1–12> (показать, как в этот месяц)',
      usage: '[month]',
      run: ([m]) => {
        if (m) {
          // the look of another month, for a look (the clock stays)
          const month = Math.max(1, Math.min(12, Number(m))) - 1
          api.render.setCover({
            snow: cfg.snow[month],
            ice: cfg.ice[month],
            litter: cfg.litter[month],
            litterColors: month >= 2 && month <= 4 ? cfg.petals : cfg.leaves,
          })
          falling.set(Math.round(cfg.falling[month]! * cfg.maxFalling), month >= 2 && month <= 4 ? cfg.petals : cfg.leaves)
          tell(cfg.snow[month]!, cfg.ice[month]!, cfg.litter[month]!)
          check = 30
        }
        return `снег ${now.snow.toFixed(2)} · лёд ${now.ice.toFixed(2)} · листва ${now.litter.toFixed(2)} · в воздухе ${now.falling.toFixed(2)}`
      },
    })
  },
})

/** Leaves (or petals) drifting down around the camera: one instanced draw, nothing made per frame. */
class Falling {
  private mesh: InstanceType<PluginApi['render']['three']['InstancedMesh']>
  /** Per leaf: x, y, z, ground y, phase, spin, speed. */
  private s: Float32Array
  private count = 0
  private time = 0
  private m: InstanceType<PluginApi['render']['three']['Matrix4']>
  private q: InstanceType<PluginApi['render']['three']['Quaternion']>
  private e: InstanceType<PluginApi['render']['three']['Euler']>
  private p: InstanceType<PluginApi['render']['three']['Vector3']>
  private sc: InstanceType<PluginApi['render']['three']['Vector3']>
  private colors: [InstanceType<PluginApi['render']['three']['Color']>, InstanceType<PluginApi['render']['three']['Color']>]
  private tint: InstanceType<PluginApi['render']['three']['Color']>

  constructor(
    private api: PluginApi,
    private cfg: Config,
  ) {
    const T = api.render.three
    // a leaf: a soft pointed oval, white (tinted per instance)
    const c = document.createElement('canvas')
    c.width = c.height = 32
    const g = c.getContext('2d')!
    g.fillStyle = '#fff'
    g.beginPath()
    g.moveTo(16, 2)
    g.quadraticCurveTo(30, 16, 16, 30)
    g.quadraticCurveTo(2, 16, 16, 2)
    g.fill()
    const tex = new T.CanvasTexture(c)
    const mat = api.render.stylize(new T.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: T.DoubleSide }))
    const geo = new T.PlaneGeometry(1, 1)
    const max = Math.max(1, cfg.maxFalling)
    this.mesh = new T.InstancedMesh(geo, mat, max)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
    this.mesh.instanceColor = new T.InstancedBufferAttribute(new Float32Array(max * 3), 3)
    api.render.add(this.mesh)
    api.onDispose(() => {
      tex.dispose()
      geo.dispose()
      mat.dispose()
    })
    this.s = new Float32Array(max * 7)
    this.m = new T.Matrix4()
    this.q = new T.Quaternion()
    this.e = new T.Euler()
    this.p = new T.Vector3()
    this.sc = new T.Vector3()
    this.colors = [new T.Color(), new T.Color()]
    this.tint = new T.Color()
  }

  /** How many fall (up to the config's most) and in which two colors. */
  set(n: number, colors: readonly [string, string]): void {
    const max = this.mesh.instanceMatrix.count
    const want = Math.min(n, max)
    this.colors[0].set(colors[0])
    this.colors[1].set(colors[1])
    for (let i = this.count; i < want; i++) this.spawn(i, true)
    if (want !== this.count) for (let i = 0; i < want; i++) this.paint(i)
    this.count = want
    this.mesh.count = want
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  update(dt: number): void {
    if (!this.count) return
    this.time += dt
    const s = this.s
    const fall = this.cfg.fallSpeed
    for (let i = 0; i < this.count; i++) {
      const o = i * 7
      s[o + 1]! -= s[o + 6]! * fall * dt
      // it sways as it falls, and the breeze carries it a little
      s[o]! += Math.sin(this.time * 1.3 + s[o + 4]!) * 0.6 * dt + 0.15 * dt
      s[o + 2]! += Math.cos(this.time * 1.1 + s[o + 4]! * 1.7) * 0.5 * dt
      if (s[o + 1]! < s[o + 3]!) this.spawn(i, false)
      this.e.set(Math.sin(this.time * 2 + s[o + 4]!) * 0.9, this.time * s[o + 5]!, Math.cos(this.time * 1.6 + s[o + 4]!) * 0.7)
      this.q.setFromEuler(this.e)
      this.p.set(s[o]!, s[o + 1]!, s[o + 2]!)
      this.sc.setScalar(this.cfg.size)
      this.m.compose(this.p, this.q, this.sc)
      this.mesh.setMatrixAt(i, this.m)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }

  /** A leaf somewhere around the camera: high up (or anywhere in the air, the first time). */
  private spawn(i: number, anywhere: boolean): void {
    const t = this.api.render.camera.target
    const r = this.cfg.radius
    const a = Math.random() * Math.PI * 2
    const d = Math.sqrt(Math.random()) * r
    const x = t.x + Math.cos(a) * d
    const z = t.z + Math.sin(a) * d
    const ground = this.api.world.surfaceY(Math.floor(x), Math.floor(z))
    const o = i * 7
    this.s[o] = x
    this.s[o + 1] = ground + (anywhere ? Math.random() * 7 : 6 + Math.random() * 2)
    this.s[o + 2] = z
    this.s[o + 3] = ground
    this.s[o + 4] = Math.random() * 10
    this.s[o + 5] = 0.5 + Math.random() * 1.5
    this.s[o + 6] = 0.6 + Math.random() * 0.6
  }

  private paint(i: number): void {
    this.tint.copy(this.colors[0]).lerp(this.colors[1], Math.random())
    this.mesh.setColorAt(i, this.tint)
  }
}
