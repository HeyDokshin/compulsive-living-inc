/**
 * Real weather: an approximate place (from the internet address, no permission asked) and an hourly
 * forecast for it. Reading the answers is pure and tested; `LiveWeather` fetches and remembers them.
 */
export interface Place {
  /** Rounded: a neighbourhood, not an address. */
  lat: number
  lon: number
  name: string
}

/** Hours in a row (`time` in ms); the same index everywhere. */
export interface Hourly {
  time: number[]
  code: number[]
  /** mm of water per hour. */
  rain: number[]
  /** cm of snow per hour. */
  snow: number[]
  /** Percent of the sky. */
  cloud: number[]
  /** km/h */
  wind: number[]
  /** °C */
  temp: number[]
}

export interface Moment {
  code: number
  rain: number
  snow: number
  cloud: number
  wind: number
  temp: number
}

const HOUR = 3_600_000
/** Never ask again sooner than this, even if the hour turned meanwhile. */
const PAUSE = HOUR / 3

const num = (v: unknown): number => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN)
const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {})

/** A place out of an address service's answer (they agree on `latitude`, `longitude`, `city`), or null. */
export function parsePlace(data: unknown, step: number): Place | null {
  const d = obj(data)
  const lat = num(d.latitude)
  const lon = num(d.longitude)
  if (d.success === false || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  if (num(d.accuracy) > 500) return null // only the country is known: its middle says nothing
  const round = (v: number) => Number((Math.round(v / step) * step).toFixed(3))
  return { lat: round(lat), lon: round(lon), name: typeof d.city === 'string' ? d.city : '' }
}

/** The forecast service's answer, or null when something is missing. */
export function parseHourly(data: unknown): Hourly | null {
  const h = obj(obj(data).hourly)
  const list = (key: string): number[] | null => {
    const v = h[key]
    return Array.isArray(v) ? v.map((x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)) : null
  }
  const time = list('time')
  const code = list('weather_code')
  const rain = list('precipitation')
  const snow = list('snowfall')
  const cloud = list('cloud_cover')
  const wind = list('wind_speed_10m')
  const temp = list('temperature_2m')
  if (!time?.length || !code || !rain || !snow || !cloud || !wind || !temp) return null
  if ([code, rain, snow, cloud, wind, temp].some((l) => l.length !== time.length)) return null
  return { time: time.map((t) => t * 1000), code, rain, snow, cloud, wind, temp }
}

/** The weather at a moment: the code of its hour, the amounts on their way to the next one. Null outside the forecast. */
export function momentAt(h: Hourly, ms: number): Moment | null {
  const first = h.time[0]
  if (first === undefined) return null
  const i = Math.floor((ms - first) / HOUR)
  if (i < 0 || i >= h.time.length) return null
  const k = (ms - h.time[i]!) / HOUR
  const j = Math.min(h.time.length - 1, i + 1)
  const mix = (l: number[]) => l[i]! + (l[j]! - l[i]!) * k
  return { code: h.code[i]!, rain: mix(h.rain), snow: mix(h.snow), cloud: mix(h.cloud), wind: mix(h.wind), temp: mix(h.temp) }
}

/** The weather type for a code, else the nearest lower code's (services add new ones in between). */
export function typeFor<T extends { codes: readonly number[] }>(types: readonly T[], code: number): T | undefined {
  let best: T | undefined
  let bestCode = -1
  for (const t of types)
    for (const c of t.codes)
      if (c <= code && c > bestCode) {
        best = t
        bestCode = c
      }
  return best
}

/** Day numbers (local) that the forecast covers, with whether a watering weather came. */
export function rainyDays(h: Hourly, waters: (code: number) => boolean, until: number): Map<number, boolean> {
  const out = new Map<number, boolean>()
  h.time.forEach((t, i) => {
    if (t > until) return
    const d = new Date(t)
    const day = Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000)
    out.set(day, (out.get(day) ?? false) || waters(h.code[i]!))
  })
  return out
}

export interface LiveConfig {
  placeUrls: string[]
  forecastUrl: string
  placeStep: number
  placeHours: number
  retryMinutes: number
  timeout: number
}

interface Cache {
  place?: Place
  placeAt?: number
  hourly?: Hourly
  hourlyAt?: number
}

export class LiveWeather {
  private cache: Cache = {}
  private busy: AbortController | null = null
  private retryAt = 0
  /** Everybody's hour turns at the same time: not everybody asks at once. */
  private late = Math.random() * 180_000

  constructor(
    private cfg: LiveConfig,
    private store: { read(): unknown; write(v: unknown): void },
    private ask: (url: string, signal: AbortSignal) => Promise<unknown>,
    private log: (text: string, e: unknown) => void,
  ) {
    this.cache = obj(store.read()) as Cache
  }

  get hourly(): Hourly | null {
    return this.cache.hourly ?? null
  }

  get place(): Place | null {
    return this.cache.place ?? null
  }

  get updatedAt(): number {
    return this.cache.hourlyAt ?? 0
  }

  /** Is it time to ask again? Once per clock hour (a little after it turned), later after a failure. */
  due(now: number): boolean {
    if (this.busy || now < this.retryAt) return false
    const at = this.cache.hourlyAt
    if (at === undefined) return true
    return now - at >= PAUSE && Math.floor((now - this.late) / HOUR) > Math.floor((at - this.late) / HOUR)
  }

  async update(now: number): Promise<boolean> {
    const abort = (this.busy = new AbortController())
    const timer = setTimeout(() => abort.abort(), this.cfg.timeout * 1000)
    try {
      const place = await this.findPlace(now, abort.signal)
      const url = this.cfg.forecastUrl.replace('{lat}', String(place.lat)).replace('{lon}', String(place.lon))
      const hourly = parseHourly(await this.ask(url, abort.signal))
      if (!hourly) throw new Error('unexpected forecast')
      this.cache = { ...this.cache, hourly, hourlyAt: now }
      this.store.write(this.cache)
      return true
    } catch (e) {
      this.retryAt = now + this.cfg.retryMinutes * 60_000
      this.log('no real weather now:', e)
      return false
    } finally {
      clearTimeout(timer)
      this.busy = null
    }
  }

  stop(): void {
    this.busy?.abort()
  }

  /** Forget the place and the forecast (the player turned real weather off). */
  forget(): void {
    this.stop()
    this.cache = {}
    this.retryAt = 0
    this.store.write(null)
  }

  private async findPlace(now: number, signal: AbortSignal): Promise<Place> {
    const { place, placeAt } = this.cache
    if (place && placeAt !== undefined && now - placeAt < this.cfg.placeHours * HOUR) return place
    for (const url of this.cfg.placeUrls) {
      try {
        const found = parsePlace(await this.ask(url, signal), this.cfg.placeStep)
        if (found) {
          this.cache = { ...this.cache, place: found, placeAt: now }
          return found
        }
      } catch (e) {
        if (signal.aborted) throw e
        this.log('place service:', e)
      }
    }
    if (place) return place // yesterday's is better than none
    throw new Error('no place')
  }
}
