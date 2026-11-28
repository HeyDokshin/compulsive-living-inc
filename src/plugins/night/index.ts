/**
 * The island at night: stars show in the open water (fewer under clouds), and on warm nights
 * fireflies drift low over the grass around you, blinking on and off. Purely for the look: the
 * fireflies you can catch are the bugs plugin's; these are the ones that just glow.
 */
import { definePlugin, z, type PluginApi } from '@sdk'

const Config = z.object({
  /** How bright the stars in the water are on a clear night. */
  stars: z.number().min(0).max(1).default(0.9).meta({ step: 0.05 }),
  /** Fireflies: the months they are out (1–12, the south turns them round) and from when to when at night. */
  fireflyMonths: z.array(z.number().int().min(1).max(12)).default([6, 7, 8]),
  fireflyHours: z.tuple([z.number(), z.number()]).default([20, 3]),
  /** How many around you, how far out, how big their glow, its color. */
  fireflies: z.number().int().min(0).max(200).default(36).meta({ step: 1 }),
  radius: z.number().min(3).max(30).default(11).meta({ step: 1 }),
  size: z.number().min(0.05).max(2).default(0.32).meta({ step: 0.01 }),
  color: z.string().default('#e8ff7a').meta({ color: true }),
})
type Config = z.infer<typeof Config>

export default definePlugin({
  id: 'night',
  version: '0.1.0',
  description: 'Ночь: звёзды в воде, светлячки летом',
  optionalDependsOn: ['weather'],

  setup(api) {
    const cfg = api.config.define(Config)
    const flies = new Fireflies(api, cfg)
    let check = 0
    let want = 0
    api.systems.add({
      id: 'night',
      phase: 'render',
      run: ({ dt }) => {
        if ((check -= dt) <= 0) {
          check = 0.5
          const h = api.time.hour
          // dark from dusk to dawn, soft at both ends
          const dark = Math.min(1, Math.max(0, (Math.abs(h - 12.5) - 6.5) / 1.2))
          const w = api.services.has('weather:forecast') ? api.services.get('weather:forecast').current() : undefined
          const clear = w ? Math.max(0, Math.min(1, w.light.sun)) : 1
          const inside = api.interiors.current !== null
          api.render.setCover({ stars: inside ? 0 : dark * clear * cfg.stars })
          const month = api.time.now().month + 1
          const south = api.engineConfig.time.hemisphere === 'south'
          const m = south ? ((month + 5) % 12) + 1 : month
          const [from, to] = cfg.fireflyHours
          const hours = from <= to ? h >= from && h < to : h >= from || h < to
          const dry = !w || w.precipitation === 'none'
          want = !inside && dry && hours && cfg.fireflyMonths.includes(m) ? cfg.fireflies : 0
        }
        flies.update(dt, want)
      },
    })
    api.onDispose(() => api.render.setCover({ stars: 0 }))
  },
})

/** Glowing points drifting over the grass, each blinking in its own rhythm: one draw, nothing made per frame. */
class Fireflies {
  private points: InstanceType<PluginApi['render']['three']['Points']>
  private pos: Float32Array
  private col: Float32Array
  /** Per firefly: home x, z, phase, blink speed, height. */
  private s: Float32Array
  private shown = 0
  private fade = 0
  private time = 0
  private base: InstanceType<PluginApi['render']['three']['Color']>

  constructor(
    private api: PluginApi,
    private cfg: Config,
  ) {
    const T = api.render.three
    const max = Math.max(1, cfg.fireflies)
    this.pos = new Float32Array(max * 3)
    this.col = new Float32Array(max * 3)
    this.s = new Float32Array(max * 5)
    const geo = new T.BufferGeometry()
    geo.setAttribute('position', new T.BufferAttribute(this.pos, 3))
    geo.setAttribute('color', new T.BufferAttribute(this.col, 3))
    // a soft round glow
    const c = document.createElement('canvas')
    c.width = c.height = 32
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.25, 'rgba(255,255,255,0.6)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 32, 32)
    const tex = new T.CanvasTexture(c)
    const mat = api.render.stylize(
      // the camera is orthographic: point sizes are pixels (set from the zoom each frame)
      new T.PointsMaterial({
        size: 8,
        map: tex,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
        sizeAttenuation: false,
      }),
    )
    this.points = new T.Points(geo, mat)
    this.points.name = 'night:fireflies'
    this.points.frustumCulled = false
    this.points.visible = false
    api.render.add(this.points)
    api.onDispose(() => {
      geo.dispose()
      mat.dispose()
      tex.dispose()
    })
    this.base = new T.Color()
  }

  update(dt: number, want: number): void {
    this.time += dt
    // they come out (and go) slowly
    this.fade = Math.max(0, Math.min(1, this.fade + (want > 0 ? dt : -dt) * 0.4))
    const n = Math.min(this.s.length / 5, want > 0 ? want : this.shown)
    for (let i = this.shown; i < n; i++) this.spawn(i)
    this.shown = n
    this.points.visible = this.fade > 0 && n > 0
    if (!this.points.visible) {
      if (this.fade === 0) this.shown = 0
      return
    }
    this.base.set(this.cfg.color)
    ;(this.points.material as InstanceType<PluginApi['render']['three']['PointsMaterial']>).size = this.cfg.size * this.api.render.pixelsPerBlock
    const t = this.api.render.camera.target
    const r = this.cfg.radius
    for (let i = 0; i < n; i++) {
      const o = i * 5
      // wander round their spot; a firefly left behind as you walk on comes round in front of you
      if (Math.abs(this.s[o]! - t.x) > r || Math.abs(this.s[o + 1]! - t.z) > r) this.spawn(i)
      const ph = this.s[o + 2]!
      const x = this.s[o]! + Math.sin(this.time * 0.4 + ph) * 1.2
      const z = this.s[o + 1]! + Math.cos(this.time * 0.33 + ph * 1.3) * 1.2
      this.pos[i * 3] = x
      this.pos[i * 3 + 1] = this.s[o + 4]! + Math.sin(this.time * 0.9 + ph * 2) * 0.25
      this.pos[i * 3 + 2] = z
      // blink: a faint glow, lighting up now and then
      const b = (0.18 + 1.4 * Math.max(0, Math.sin(this.time * this.s[o + 3]! + ph)) ** 4) * this.fade
      this.col[i * 3] = this.base.r * b
      this.col[i * 3 + 1] = this.base.g * b
      this.col[i * 3 + 2] = this.base.b * b
    }
    const geo = this.points.geometry
    geo.setDrawRange(0, n)
    geo.getAttribute('position').needsUpdate = true
    geo.getAttribute('color').needsUpdate = true
  }

  private spawn(i: number): void {
    const t = this.api.render.camera.target
    const r = this.cfg.radius
    const x = t.x + (Math.random() * 2 - 1) * r * 0.9
    const z = t.z + (Math.random() * 2 - 1) * r * 0.9
    const o = i * 5
    this.s[o] = x
    this.s[o + 1] = z
    this.s[o + 2] = Math.random() * 20
    this.s[o + 3] = 0.8 + Math.random() * 1.6
    this.s[o + 4] = this.api.world.surfaceY(Math.floor(x), Math.floor(z)) + 0.4 + Math.random() * 1.2
  }
}
