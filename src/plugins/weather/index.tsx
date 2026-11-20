/**
 * Weather: types in the `weather:types` registry (content/weather/weather.types.json5), chosen every
 * 6 game hours per season and island seed. Changes the light (darker, tinted skies), draws rain or
 * snow around the camera, plays rain, and tells other plugins (`weather:forecast` service) whether it
 * rained on a day — the garden counts that as watering.
 */
import { definePlugin, signal, ui, z, type LoopHandle, type PluginApi, type RegistryEntry } from '@sdk'
import { rainedOn, weatherAt } from './forecast'

export interface WeatherDef extends RegistryEntry {
  name: string
  icon: string
  weights: Partial<Record<'spring' | 'summer' | 'autumn' | 'winter', number>>
  light: { sun: number; ambient: number; tint?: string; tintAmount?: number }
  precipitation?: 'none' | 'rain' | 'snow'
  waters?: boolean
}

export interface WeatherForecast {
  /** Weather right now. */
  current(): WeatherDef | undefined
  /** Did watering weather (rain) happen on that game day? */
  rainedOn(dayIndex: number): boolean
}

declare module '@sdk' {
  interface Registries {
    'weather:types': WeatherDef
  }
  interface Services {
    'weather:forecast': WeatherForecast
  }
  interface GameEvents {
    'weather:changed': { id: string }
  }
}

const TypeSchema = z.looseObject({
  id: z.string(),
  tags: z.array(z.string()).optional(),
  name: z.string(),
  icon: z.string().default('☀️'),
  weights: z.record(z.string(), z.number()).default({}),
  light: z.object({ sun: z.number().default(1), ambient: z.number().default(1), tint: z.string().optional(), tintAmount: z.number().default(0) }).prefault({}),
  precipitation: z.enum(['none', 'rain', 'snow']).default('none'),
  waters: z.boolean().default(false),
})

const Config = z.object({
  /** Force a weather id ('' = follow the forecast). */
  force: z.string().default(''),
  /** Seconds to blend between two weathers. */
  blend: z.number().min(0.5).max(60).default(8).meta({ step: 0.5 }),
  rainDrops: z.number().int().min(0).max(4000).default(900).meta({ label: 'rain drops', step: 50 }),
  snowFlakes: z.number().int().min(0).max(4000).default(700).meta({ label: 'snow flakes', step: 50 }),
  rainVolume: z.number().min(0).max(1).default(0.28).meta({ label: 'rain volume', step: 0.01 }),
  /** Area around the camera where it rains (blocks). */
  radius: z.number().min(4).max(40).default(15).meta({ step: 1 }),
})
type Config = z.infer<typeof Config>

export default definePlugin({
  id: 'weather',
  version: '0.1.0',
  description: 'Погода: ясно, облачно, дождь, снег',
  optionalDependsOn: ['daily'],

  setup(api) {
    const cfg = api.config.define(Config)
    const types = api.createRegistry<WeatherDef>('weather:types', TypeSchema as never)
    const all = () => types.all() as WeatherDef[]
    const choose = (): WeatherDef | undefined => {
      if (cfg.force) return types.get(cfg.force) ?? undefined
      const now = api.time.now()
      return weatherAt(all(), api.world.seed, now.dayIndex, now.hour, now.season)
    }

    const shown = signal<WeatherDef | undefined>(undefined)
    let current: WeatherDef | undefined
    let previous: WeatherDef | undefined
    let mix = 1 // 0 → previous, 1 → current
    const check = () => {
      const next = choose()
      if (!next || next.id === current?.id) return
      previous = current ?? next
      current = next
      mix = previous === next ? 1 : 0
      shown.value = next
      api.events.emit('weather:changed', { id: next.id })
    }

    api.services.provide('weather:forecast', {
      current: () => current,
      rainedOn: (day) => (cfg.force ? !!types.get(cfg.force)?.waters : rainedOn(all(), api.world.seed, day, api.time.season)),
    })

    // Light: blend multipliers and tint between the previous and current weather.
    const tint = new api.render.three.Color()
    api.hooks.tap('light:adjust', (st) => {
      if (!current) return st
      const a = previous?.light ?? current.light
      const b = current.light
      const lerp = (x: number, y: number) => x + (y - x) * mix
      st.sunIntensity *= lerp(a.sun, b.sun)
      st.ambient *= lerp(a.ambient, b.ambient)
      const amountA = a.tint ? (a.tintAmount ?? 0) : 0
      const amountB = b.tint ? (b.tintAmount ?? 0) : 0
      const amount = lerp(amountA, amountB)
      if (amount > 0) {
        tint.set(b.tint ?? a.tint ?? '#ffffff')
        st.sky.lerp(tint, amount)
        st.background.lerp(tint, amount * 1.2)
        st.sun.lerp(tint, amount * 0.6)
      }
      return st
    })

    const fx = new Precipitation(api, cfg)
    let checkIn = 0
    api.systems.add({
      id: 'weather',
      phase: 'render',
      run: ({ dt }) => {
        if ((checkIn -= dt) <= 0) {
          checkIn = 1
          check()
        }
        mix = Math.min(1, mix + dt / cfg.blend)
        const kind = (p?: WeatherDef) => p?.precipitation ?? 'none'
        // fade the old precipitation out and the new one in
        const rain = (kind(current) === 'rain' ? mix : 0) + (kind(previous) === 'rain' ? 1 - mix : 0)
        const snow = (kind(current) === 'snow' ? mix : 0) + (kind(previous) === 'snow' ? 1 - mix : 0)
        // nothing falls indoors
        const out = api.interiors.current ? 0 : 1
        fx.update(dt, rain * out, snow * out)
      },
    })
    api.config.onChange(() => (checkIn = 0))
    api.events.on('session:started', () => (checkIn = 0))

    api.ui.slot('hud.topRight', () => <WeatherPill shown={shown} />, { order: 10 })

    // A line for the morning note: the day's forecast, merging repeats ("утром и днём ясно").
    try {
      api.registry('daily:sections').register({
        id: 'weather:today',
        order: 10,
        line: () => {
          const now = api.time.now()
          const parts: Array<[string, WeatherDef | undefined]> = [
            ['утром', weatherAt(all(), api.world.seed, now.dayIndex, 8, now.season)],
            ['днём', weatherAt(all(), api.world.seed, now.dayIndex, 13, now.season)],
            ['вечером', weatherAt(all(), api.world.seed, now.dayIndex, 19, now.season)],
          ]
          const groups: Array<[string[], WeatherDef]> = []
          for (const [when, w] of parts) {
            if (!w) continue
            const last = groups[groups.length - 1]
            if (last && last[1].id === w.id) last[0].push(when)
            else groups.push([[when], w])
          }
          if (!groups.length) return null
          const text = groups.length === 1 ? `Весь день ${groups[0]![1].name.toLowerCase()}` : groups.map(([w, d]) => `${w.join(' и ')} ${d.name.toLowerCase()}`).join(', ')
          return { icon: (current ?? groups[0]![1]).icon, text: text[0]!.toUpperCase() + text.slice(1) + '.' }
        },
      })
    } catch {
      // no daily notes
    }
    api.commands.register({
      name: 'weather',
      description: 'Погода: weather (прогноз на сегодня) · weather <id> (зафиксировать) · weather auto',
      usage: '[id | auto]',
      run: ([id]) => {
        if (id === 'auto') cfg.force = ''
        else if (id) {
          const full = id.includes(':') ? id : `weather:${id}`
          if (!types.has(full)) throw new Error(`нет погоды "${id}": ${types.ids().join(', ')}`)
          cfg.force = full
        }
        checkIn = 0
        const now = api.time.now()
        const day = [0, 6, 12, 18].map((h) => `${String(h).padStart(2, '0')}:00 ${weatherAt(all(), api.world.seed, now.dayIndex, h, now.season)?.name ?? '?'}`)
        return `сейчас: ${choose()?.name ?? '?'}${cfg.force ? ' (зафиксировано)' : ''}\nсегодня: ${day.join(' · ')}`
      },
    })
  },
})

function WeatherPill({ shown }: { shown: ReturnType<typeof signal<WeatherDef | undefined>> }) {
  const w = shown.value
  if (!w) return null
  return (
    <ui.Pill>
      <span>{w.icon}</span>
      <span>{w.name}</span>
    </ui.Pill>
  )
}

type Three = PluginApi['render']['three']

/** Rain streaks and snow flakes in a box around the camera, recycled as they fall. */
class Precipitation {
  private rain: Field
  private snow: Field
  private sound: LoopHandle | null = null
  private splashIn = 0

  constructor(
    private api: PluginApi,
    private cfg: Config,
  ) {
    const T = api.render.three
    this.rain = new Field(api, new T.BoxGeometry(0.025, 0.55, 0.025), '#d6e8ff', 0.55, 4000)
    this.snow = new Field(api, new T.BoxGeometry(0.08, 0.08, 0.08), '#ffffff', 0.92, 4000)
    api.onDispose(() => this.sound?.stop())
  }

  update(dt: number, rain: number, snow: number): void {
    const c = this.api.render.camera.target
    const r = this.cfg.radius
    this.rain.update(dt, Math.round(this.cfg.rainDrops * rain), c, r, { fall: 15, drift: 1.2, sway: 0 })
    this.snow.update(dt, Math.round(this.cfg.snowFlakes * snow), c, r, { fall: 1.6, drift: 0.3, sway: 0.6 })

    if (this.api.audio.ready) {
      this.sound ??= this.api.audio.loop({ wave: 'noise', filter: { type: 'bandpass', freq: 1700, q: 0.45 } })
      this.sound?.setGain(this.cfg.rainVolume * rain, 1.5)
    }
    // little splashes on the ground near the player
    if (rain > 0.3 && (this.splashIn -= dt) <= 0) {
      this.splashIn = 0.06 / rain
      const x = c.x + (Math.random() * 2 - 1) * r * 0.6
      const z = c.z + (Math.random() * 2 - 1) * r * 0.6
      const y = this.api.world.surfaceY(x, z)
      if (y > 0) this.api.fx.burst('core:splash', { x, y: y - 0.1, z }, { amount: 0.25, scale: 0.6 })
    }
  }
}

class Field {
  private mesh: InstanceType<Three['InstancedMesh']>
  private pos: Float32Array
  private phase: Float32Array
  private m: InstanceType<Three['Matrix4']>
  private time = 0

  constructor(
    api: PluginApi,
    geo: NonNullable<ConstructorParameters<Three['InstancedMesh']>[0]>,
    color: string,
    opacity: number,
    private max: number,
  ) {
    const T = api.render.three
    const mat = api.render.stylize(new T.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }))
    this.mesh = api.render.add(new T.InstancedMesh(geo, mat, max))
    this.mesh.count = 0
    this.mesh.frustumCulled = false
    this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage)
    this.pos = new Float32Array(max * 3).fill(NaN)
    this.phase = new Float32Array(max).map(() => Math.random() * Math.PI * 2)
    this.m = new T.Matrix4()
  }

  update(dt: number, count: number, c: { x: number; y: number; z: number }, r: number, motion: { fall: number; drift: number; sway: number }): void {
    this.time += dt
    const n = Math.min(this.max, count)
    this.mesh.count = n
    if (!n) return
    const top = c.y + 14
    const bottom = c.y - 3
    for (let i = 0; i < n; i++) {
      const o = i * 3
      let x = this.pos[o]!
      let y = this.pos[o + 1]!
      let z = this.pos[o + 2]!
      // (re)spawn: new particles start anywhere in the column, recycled ones at the top
      const away = Math.abs(x - c.x) > r || Math.abs(z - c.z) > r
      if (Number.isNaN(x) || y < bottom || away) {
        x = c.x + (Math.random() * 2 - 1) * r
        z = c.z + (Math.random() * 2 - 1) * r
        y = Number.isNaN(this.pos[o]!) || away ? bottom + Math.random() * (top - bottom) : top
      }
      y -= motion.fall * dt
      x += motion.drift * dt + Math.sin(this.time * 1.3 + this.phase[i]!) * motion.sway * dt
      this.pos[o] = x
      this.pos[o + 1] = y
      this.pos[o + 2] = z
      this.m.makeTranslation(x, y, z)
      this.mesh.setMatrixAt(i, this.m)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }
}
