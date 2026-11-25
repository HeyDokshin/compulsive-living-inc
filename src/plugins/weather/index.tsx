/**
 * Weather. By default it is the real one outside: an approximate place from the internet address (no
 * permission asked) and an hourly forecast for it, asked for again every hour; without a network, or
 * if the player prefers, the island makes its own, hour by hour. Types are data
 * (content/weather/weather.types.json5). It changes the light, draws rain, snow, mist and lightning,
 * moves the plants, and tells other plugins (`weather:forecast`) what it is like and on which days it
 * rained — the garden counts that as watering.
 */
import { definePlugin, effect, signal, ui, z, type LoopHandle, type PluginApi, type RegistryEntry } from '@sdk'
import { dayWeather, rainedOn, weatherAt, type SeasonName } from './forecast'
import { LiveWeather, momentAt, rainyDays, typeFor, type Moment } from './live'

export interface WeatherDef extends RegistryEntry {
  name: string
  icon: string
  night?: { name: string; icon: string }
  /** WMO weather codes it stands for. */
  codes: number[]
  weights: Partial<Record<SeasonName, number>>
  hours: Array<[number, number, number]>
  light: { sun: number; ambient: number; tint?: string; tintAmount: number }
  precipitation: 'none' | 'rain' | 'snow'
  intensity: number
  mist: number
  lightning: boolean
  wind: number
  waters: boolean
}

export interface WeatherForecast {
  /** Weather right now. */
  current(): WeatherDef | undefined
  /** Did watering weather (rain) happen on that game day? */
  rainedOn(dayIndex: number): boolean
  /** Is it the real weather outside (and not the island's own)? */
  live(): boolean
  /** Real temperature (°C), when known. */
  temperature(): number | null
  /** 0 = still … 1 = a strong wind. */
  wind(): number
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
  night: z.object({ name: z.string(), icon: z.string() }).optional(),
  codes: z.array(z.number()).default([]),
  weights: z.record(z.string(), z.number()).default({}),
  hours: z.array(z.tuple([z.number(), z.number(), z.number()])).default([]),
  light: z.object({ sun: z.number().default(1), ambient: z.number().default(1), tint: z.string().optional(), tintAmount: z.number().default(0) }).prefault({}),
  precipitation: z.enum(['none', 'rain', 'snow']).default('none'),
  intensity: z.number().min(0).max(4).default(1),
  mist: z.number().min(0).max(1).default(0),
  lightning: z.boolean().default(false),
  wind: z.number().min(0).max(1.5).default(0.25),
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
  windVolume: z.number().min(0).max(1).default(0.2).meta({ label: 'wind volume', step: 0.01 }),
  mist: z.number().min(0).max(1).default(0.16).meta({ label: 'mist opacity', step: 0.01 }),
  /** Brightness of lightning (0 = none). */
  lightning: z.number().min(0).max(3).default(0.9).meta({ step: 0.05 }),
  /** Seconds between flashes: from, to. */
  flashFrom: z.number().min(1).max(120).default(7).meta({ label: 'flash from (s)', step: 1 }),
  flashTo: z.number().min(1).max(240).default(24).meta({ label: 'flash to (s)', step: 1 }),
  /** Area around the camera where it rains (blocks). */
  radius: z.number().min(4).max(40).default(15).meta({ step: 1 }),
  /** Real weather: how the amounts of the forecast turn into drops, wind and light. */
  real: z
    .object({
      /** Share of drops for the lightest rain, plus this per mm (cm of snow) an hour, up to `most`. */
      least: z.number().min(0).max(2).default(0.35).meta({ step: 0.05 }),
      perMm: z.number().min(0).max(2).default(0.35).meta({ label: 'per mm', step: 0.05 }),
      most: z.number().min(0.2).max(4).default(2).meta({ step: 0.1 }),
      /** km/h that count as a strong wind; from `windyFrom` a dry day is called windy. */
      strongWind: z.number().min(5).max(150).default(50).meta({ label: 'strong wind (km/h)', step: 1 }),
      windyFrom: z.number().min(5).max(150).default(34).meta({ label: 'windy from (km/h)', step: 1 }),
      windyType: z.string().default('weather:windy'),
      /** Share of the sun a full cover of cloud takes on a dry day. */
      cloudShade: z.number().min(0).max(1).default(0.58).meta({ label: 'cloud shade', step: 0.02 }),
      /** Where the place comes from: asked in turn until one knows. */
      placeUrls: z.array(z.string()).default(['https://ipwho.is/?fields=success,city,latitude,longitude', 'https://get.geojs.io/v1/ip/geo.json']),
      forecastUrl: z
        .string()
        .default(
          'https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&hourly=weather_code,precipitation,snowfall,cloud_cover,wind_speed_10m,temperature_2m&past_days=3&forecast_days=3&timeformat=unixtime',
        ),
      /** The place is rounded to this many degrees before it is kept or sent. */
      placeStep: z.number().min(0.01).max(2).default(0.1).meta({ label: 'place step°', step: 0.01 }),
      placeHours: z.number().min(1).max(240).default(24).meta({ label: 'keep place (h)', step: 1 }),
      retryMinutes: z.number().min(1).max(240).default(10).meta({ label: 'retry (min)', step: 1 }),
      timeout: z.number().min(1).max(60).default(8).meta({ label: 'timeout (s)', step: 1 }),
    })
    .prefault({}),
})
type Config = z.infer<typeof Config>

const OPTION = 'weather:source'
const CACHE = 'cl-weather'
/** Days whose rain is remembered (with the island). */
const REMEMBER = 60

/** Everything about the weather that eases from one to the next. */
interface Look {
  sun: number
  ambient: number
  tint: number
  rain: number
  snow: number
  mist: number
  wind: number
}

const CALM: Look = { sun: 1, ambient: 1, tint: 0, rain: 0, snow: 0, mist: 0, wind: 0.2 }

export default definePlugin({
  id: 'weather',
  version: '0.2.0',
  description: 'Погода: настоящая за окном или своя у острова',
  optionalDependsOn: ['daily'],

  setup(api) {
    const cfg = api.config.define(Config)
    const types = api.createRegistry<WeatherDef>('weather:types', TypeSchema as never)
    const all = () => types.all()

    /** Seconds to the next look at the forecast. */
    let checkIn = 0

    // --- the real weather ---------------------------------------------------------------------------
    const live = new LiveWeather(
      cfg.real,
      {
        read: () => {
          try {
            return JSON.parse(localStorage.getItem(CACHE) ?? 'null')
          } catch {
            return null
          }
        },
        write: (v) => {
          try {
            if (v === null) localStorage.removeItem(CACHE)
            else localStorage.setItem(CACHE, JSON.stringify(v))
          } catch {
            // not remembered: asked again next time
          }
        },
      },
      async (url, signal) => {
        const r = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' })
        if (!r.ok) throw new Error(`${r.status} ${new URL(url).host}`)
        return (await r.json()) as unknown
      },
      (text, e) => api.log.info(text, e instanceof Error ? e.message : String(e)),
    )
    api.onDispose(() => live.stop())
    const wanted = () => api.options.get(OPTION) === 'real'
    const statusVersion = signal(0)
    api.registry('options').register({
      id: OPTION,
      order: 10,
      label: 'Погода',
      choices: [
        ['real', 'Как за окном'],
        ['island', 'Своя у острова'],
      ],
      default: 'real',
      hint: () => {
        statusVersion.value
        if (!wanted()) return 'Остров сам решает, какая погода. Игра не обращается к сети за погодой.'
        const at = live.updatedAt
        const where = live.place ? live.place.name || 'место рядом с вами' : ''
        const when = at ? new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''
        const now = at && where ? `Сейчас: ${where}, обновлено в ${when}. ` : 'Погоды из сети пока нет — остров показывает свою. '
        return `${now}Город определяется примерно, по интернет-адресу (сервисы ipwho.is и geojs.io), хранится только в этом браузере и не попадает в сохранения. Прогноз: Open-Meteo.com.`
      },
    })
    const rained = new Map<number, boolean>()
    api.save.register<Array<[number, boolean]>>({
      version: 1,
      save: () => [...rained].sort((a, b) => b[0] - a[0]).slice(0, REMEMBER),
      load: (d) => {
        rained.clear()
        for (const [day, yes] of d) rained.set(day, yes)
      },
    })
    const waters = (code: number) => typeFor(all(), code)?.waters ?? false
    /** Days the forecast has already seen. */
    const learn = () => {
      const h = live.hourly
      if (!h || !wanted()) return
      for (const [day, yes] of rainyDays(h, waters, Date.now())) rained.set(day, yes || (rained.get(day) ?? false))
    }
    const refresh = async () => {
      if (!(await live.update(Date.now()))) return
      learn()
      statusVersion.value++
      checkIn = 0
    }
    api.onDispose(
      effect(() => {
        if (wanted()) learn()
        else live.forget()
        checkIn = 0
      }),
    )

    // --- what it is like now ------------------------------------------------------------------------
    let moment: Moment | null = null
    const own = (hour: number) => {
      const now = api.time.now()
      return weatherAt(all(), api.world.seed, now.dayIndex, hour, now.season)
    }
    const choose = (): WeatherDef | undefined => {
      moment = null
      if (cfg.force) return types.get(cfg.force) ?? undefined
      const now = api.time.now()
      if (wanted() && live.hourly) {
        // the game clock's hour: a clock turned far away has no real weather
        moment = momentAt(live.hourly, now.ms)
        const t = moment ? typeFor(all(), moment.code) : undefined
        if (t && moment) {
          const windy = t.precipitation === 'none' && !t.mist && moment.wind >= cfg.real.windyFrom ? types.get(cfg.real.windyType) : undefined
          return windy ?? t
        }
        moment = null
      }
      return own(now.hour)
    }
    const shown = signal<{ def: WeatherDef; night: boolean; temp: number | null } | undefined>(undefined)
    let current: WeatherDef | undefined
    const look: Look = { ...CALM }
    const goal: Look = { ...CALM }
    const tint = new api.render.three.Color('#ffffff')
    const tintGoal = new api.render.three.Color('#ffffff')
    let fresh = true
    const amount = (mm: number) => Math.min(cfg.real.most, cfg.real.least + mm * cfg.real.perMm)
    const check = () => {
      const def = choose()
      if (!def) return
      goal.sun = def.light.sun
      goal.ambient = def.light.ambient
      goal.tint = def.light.tint ? def.light.tintAmount : 0
      if (def.light.tint) tintGoal.set(def.light.tint)
      goal.mist = def.mist
      goal.wind = def.wind
      goal.rain = def.precipitation === 'rain' ? def.intensity : 0
      goal.snow = def.precipitation === 'snow' ? def.intensity : 0
      if (moment) {
        // the forecast's amounts, on their way from hour to hour
        goal.wind = Math.min(1.2, moment.wind / cfg.real.strongWind)
        if (def.precipitation === 'rain') goal.rain = amount(moment.rain)
        else if (def.precipitation === 'snow') goal.snow = amount(moment.snow)
        else if (!def.mist) goal.sun = 1 - cfg.real.cloudShade * (moment.cloud / 100)
      }
      if (fresh) {
        fresh = false
        Object.assign(look, goal)
        tint.copy(tintGoal)
      }
      if (def.waters) rained.set(api.time.dayIndex, true)
      const night = api.time.hour < 6 || api.time.hour >= 19
      const temp = moment ? Math.round(moment.temp) : null
      const s = shown.value
      if (s?.def !== def || s.night !== night || s.temp !== temp) shown.value = { def, night, temp }
      if (def.id === current?.id) return
      current = def
      api.events.emit('weather:changed', { id: def.id })
    }

    api.services.provide('weather:forecast', {
      current: () => current,
      rainedOn: (day) => (cfg.force ? !!types.get(cfg.force)?.waters : (rained.get(day) ?? rainedOn(all(), api.world.seed, day, api.time.season))),
      live: () => !!moment,
      temperature: () => (moment ? moment.temp : null),
      wind: () => look.wind,
    })

    let flash = 0
    api.hooks.tap('light:adjust', (st) => {
      st.sunIntensity *= look.sun
      st.ambient *= look.ambient + flash * cfg.lightning
      if (look.tint > 0.002) {
        st.sky.lerp(tint, look.tint)
        st.background.lerp(tint, Math.min(1, look.tint * 1.2))
        st.sun.lerp(tint, look.tint * 0.6)
      }
      return st
    })

    const fx = new Precipitation(api, cfg)
    let flashIn = cfg.flashFrom
    let thunderIn = -1
    api.systems.add({
      id: 'weather',
      phase: 'render',
      run: ({ dt }) => {
        if ((checkIn -= dt) <= 0) {
          checkIn = 1
          if (wanted() && live.due(Date.now()) && navigator.onLine !== false) void refresh()
          check()
        }
        const k = 1 - Math.exp((-3 / cfg.blend) * dt)
        for (const key of KEYS) look[key] += (goal[key] - look[key]) * k
        tint.lerp(tintGoal, k)
        api.render.setWind(0.6 + look.wind * 2)

        // lightning now and then, the thunder a little after it
        const out = api.interiors.current ? 0 : 1
        flash = Math.max(0, flash - dt * 3.2)
        if (current?.lightning && (flashIn -= dt) <= 0) {
          flashIn = cfg.flashFrom + Math.random() * Math.max(0, cfg.flashTo - cfg.flashFrom)
          flash = out * (0.6 + Math.random() * 0.4)
          thunderIn = 0.5 + Math.random() * 2.2
        }
        if (thunderIn > 0 && (thunderIn -= dt) <= 0) api.audio.play('weather:thunder', { volume: out ? 1 : 0.35 })
        fx.update(dt, look, out)
      },
    })
    api.config.onChange(() => (checkIn = 0))
    api.events.on('session:started', () => {
      fresh = true
      current = undefined
      checkIn = 0
      learn()
    })
    api.onDispose(() => api.render.setWind(1))

    api.ui.slot('hud.topRight', () => <WeatherPill shown={shown} />, { order: 10 })

    // A line for the morning note: the day's forecast, merging repeats ("утром и днём ясно").
    const atHour = (hour: number): WeatherDef | undefined => {
      const now = api.time.now()
      const m = wanted() && live.hourly && !cfg.force ? momentAt(live.hourly, now.ms + (hour - now.hour) * 3_600_000) : null
      return (m && typeFor(all(), m.code)) || own(hour)
    }
    try {
      api.registry('daily:sections').register({
        id: 'weather:today',
        order: 10,
        line: () => {
          const parts: Array<[string, WeatherDef | undefined]> = [
            ['утром', atHour(8)],
            ['днём', atHour(13)],
            ['вечером', atHour(19)],
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
      description: 'Погода: weather (сейчас и на сегодня) · weather <id> (зафиксировать) · weather auto',
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
        const mine = dayWeather(all(), api.world.seed, now.dayIndex, now.season)
        const day = mine.map((t, h) => `${String(h).padStart(2, '0')} ${(atHour(h) ?? t)?.icon ?? '?'}`).join('  ')
        return `сейчас: ${choose()?.name ?? '?'}${cfg.force ? ' (зафиксировано)' : moment ? ' (как за окном)' : ' (своя у острова)'}\nсегодня: ${day}`
      },
    })
  },
})

const KEYS = ['sun', 'ambient', 'tint', 'rain', 'snow', 'mist', 'wind'] as const satisfies ReadonlyArray<keyof Look>

function WeatherPill({ shown }: { shown: ReturnType<typeof signal<{ def: WeatherDef; night: boolean; temp: number | null } | undefined>> }) {
  const s = shown.value
  if (!s) return null
  const face = (s.night && s.def.night) || s.def
  return (
    <ui.Pill>
      <span>{face.icon}</span>
      <span>{face.name}</span>
      {s.temp !== null && <span style={{ color: 'var(--ui-text-soft)' }}>{s.temp > 0 ? `+${s.temp}` : s.temp < 0 ? `−${-s.temp}` : '0'}°</span>}
    </ui.Pill>
  )
}

type Three = PluginApi['render']['three']

/** Rain streaks, snow flakes and drifting mist around the camera, with their sounds. */
class Precipitation {
  private rain: Field
  private snow: Field
  private mist: Mist
  private rainSound: LoopHandle | null = null
  private windSound: LoopHandle | null = null
  private soundIn = 0
  private splashIn = 0
  private time = 0

  constructor(
    private api: PluginApi,
    private cfg: Config,
  ) {
    const T = api.render.three
    this.rain = new Field(api, new T.BoxGeometry(0.025, 0.55, 0.025), '#d6e8ff', 0.55, 4000)
    this.snow = new Field(api, new T.BoxGeometry(0.08, 0.08, 0.08), '#ffffff', 0.92, 4000)
    this.mist = new Mist(api)
    api.onDispose(() => {
      this.rainSound?.stop()
      this.windSound?.stop()
    })
  }

  /** `out` = 1 outdoors, 0 in a room (nothing falls there, little is heard). */
  update(dt: number, look: Look, out: number): void {
    this.time += dt
    const c = this.api.render.camera.target
    const r = this.cfg.radius
    const gust = look.wind * (0.8 + 0.2 * Math.sin(this.time * 0.7))
    this.rain.update(dt, Math.round(this.cfg.rainDrops * look.rain * out), c, r, { fall: 15, drift: 0.5 + gust * 5, sway: 0 })
    this.snow.update(dt, Math.round(this.cfg.snowFlakes * look.snow * out), c, r, { fall: 1.6, drift: 0.15 + gust * 2.4, sway: 0.6 })
    this.mist.update(dt, look.mist * this.cfg.mist * out, c, 0.25 + gust * 1.5)

    if (this.api.audio.ready && (this.soundIn -= dt) <= 0) {
      this.soundIn = 0.2
      const heard = out ? 1 : 0.3
      this.rainSound ??= this.api.audio.loop({ wave: 'noise', filter: { type: 'bandpass', freq: 1700, q: 0.45 } })
      this.rainSound?.setGain(this.cfg.rainVolume * Math.min(1.6, look.rain) * heard, 1.2)
      this.windSound ??= this.api.audio.loop({ wave: 'noise', filter: { type: 'bandpass', freq: 420, q: 1.1 } })
      this.windSound?.setGain(this.cfg.windVolume * Math.max(0, look.wind - 0.35) * heard * (0.7 + 0.3 * Math.sin(this.time * 0.9)), 1)
      this.windSound?.setFilter(340 + 260 * gust, 1)
    }
    // little splashes on the ground near the player
    const rain = look.rain * out
    if (rain > 0.2 && (this.splashIn -= dt) <= 0) {
      this.splashIn = 0.06 / rain
      const x = c.x + (Math.random() * 2 - 1) * r * 0.6
      const z = c.z + (Math.random() * 2 - 1) * r * 0.6
      const y = this.api.world.surfaceY(x, z)
      if (y > 0) this.api.fx.burst('core:splash', { x, y: y - 0.1, z }, { amount: 0.25, scale: 0.6 })
    }
  }
}

/** Soft white wisps drifting low over the ground around the camera. */
class Mist {
  private wisps: Array<{ sprite: InstanceType<Three['Sprite']>; x: number; z: number; y: number; phase: number }> = []
  private time = 0

  constructor(api: PluginApi) {
    const T = api.render.three
    const c = document.createElement('canvas')
    c.width = 128
    c.height = 64
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(64, 32, 0, 64, 32, 62)
    grad.addColorStop(0, 'rgba(255,255,255,0.95)')
    grad.addColorStop(0.5, 'rgba(255,255,255,0.45)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.setTransform(1, 0, 0, 0.5, 0, 16)
    g.fillStyle = grad
    g.fillRect(0, -64, 128, 192)
    const tex = new T.CanvasTexture(c)
    api.onDispose(() => tex.dispose())
    for (let i = 0; i < COUNT; i++) {
      const sprite = api.render.add(new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, opacity: 0 })))
      sprite.scale.set(11 + Math.random() * 6, 4.5 + Math.random() * 2, 1)
      sprite.renderOrder = 20
      sprite.visible = false
      this.wisps.push({ sprite, x: (Math.random() * 2 - 1) * REACH, z: (Math.random() * 2 - 1) * REACH, y: Math.random() * 2, phase: Math.random() * 6 })
    }
  }

  update(dt: number, opacity: number, c: { x: number; y: number; z: number }, speed: number): void {
    this.time += dt
    for (const w of this.wisps) {
      w.sprite.visible = opacity > 0.004
      if (!w.sprite.visible) continue
      // positions are kept around the camera: what leaves on one side comes back on the other
      w.x = wrap(w.x + speed * dt, c.x)
      w.z = wrap(w.z + speed * 0.35 * dt, c.z)
      const edge = Math.max(0, 1 - Math.max(Math.abs(w.x - c.x), Math.abs(w.z - c.z)) / REACH)
      w.sprite.material.opacity = opacity * Math.min(1, edge * 3) * (0.75 + 0.25 * Math.sin(this.time * 0.4 + w.phase))
      w.sprite.position.set(w.x, c.y + w.y, w.z)
    }
  }
}
const COUNT = 18
const REACH = 16
const wrap = (v: number, around: number) => around + ((((v - around + REACH) % (REACH * 2)) + REACH * 2) % (REACH * 2)) - REACH

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
