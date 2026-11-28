import { describe, expect, it, vi } from 'vitest'
import JSON5 from 'json5'
import { dayWeather, rainedOn, weatherAt, weightAt } from '../src/plugins/weather/forecast'
import { LiveWeather, momentAt, parseHourly, parsePlace, rainyDays, typeFor } from '../src/plugins/weather/live'

const types = [
  { id: 'clear', weights: { spring: 4, summer: 6, autumn: 3, winter: 3 } },
  { id: 'rain', weights: { spring: 2, summer: 1, autumn: 2, winter: 0 }, waters: true },
  { id: 'snow', weights: { winter: 3 } },
]

describe('weather forecast', () => {
  it('is deterministic per seed, day and hour, and respects seasons', () => {
    expect(dayWeather(types, 7, 100, 'autumn')).toEqual(dayWeather(types, 7, 100, 'autumn'))
    expect(weatherAt(types, 7, 100, 9.8, 'autumn')).toBe(dayWeather(types, 7, 100, 'autumn')[9])
    const summer = new Set(Array.from({ length: 200 }, (_, d) => weatherAt(types, 3, d, 12, 'summer')!.id))
    expect(summer.has('snow')).toBe(false)
    const winter = new Set(Array.from({ length: 200 }, (_, d) => weatherAt(types, 3, d, 12, 'winter')!.id))
    expect(winter.has('rain')).toBe(false)
    expect(winter.has('snow')).toBe(true)
  })

  it('mixes weathers over many days and knows rainy days', () => {
    const ids = Array.from({ length: 400 }, (_, d) => weatherAt(types, 11, d, 15, 'spring')!.id)
    const rain = ids.filter((x) => x === 'rain').length
    expect(rain).toBeGreaterThan(40)
    expect(rain).toBeLessThan(250)
    const rainyDays = Array.from({ length: 50 }, (_, d) => rainedOn(types, 11, d, 'spring')).filter(Boolean).length
    expect(rainyDays).toBeGreaterThan(5)
    expect(rainedOn(types, 11, 5, 'winter')).toBe(false)
  })
})

describe('hours of the day', () => {
  it('weather lasts some hours and changes during the day', () => {
    let changes = 0
    for (let d = 0; d < 100; d++) {
      const day = dayWeather(types, 5, d, 'spring')
      expect(day).toHaveLength(24)
      for (let h = 1; h < 24; h++) if (day[h] !== day[h - 1]) changes++
    }
    expect(changes / 100).toBeGreaterThan(1)
    expect(changes / 100).toBeLessThan(6)
  })
  it('suits the hour: fog in the morning, never at noon', () => {
    const fog = {
      id: 'fog',
      weights: { autumn: 1 },
      hours: [
        [4, 9, 5],
        [12, 19, 0],
      ] as Array<[number, number, number]>,
    }
    expect([weightAt(fog, 'autumn', 6), weightAt(fog, 'autumn', 14), weightAt(fog, 'autumn', 22), weightAt(fog, 'summer', 6)]).toEqual([5, 0, 1, 0])
    const withFog = [...types, fog]
    for (let d = 0; d < 60; d++) for (let h = 12; h < 19; h++) expect(dayWeather(withFog, 2, d, 'autumn')[h]!.id).not.toBe('fog')
  })
})

const HOUR = 3_600_000
const START = 1_800_000_000_000 - (1_800_000_000_000 % HOUR)
const answer = (n = 4) => ({
  hourly: {
    time: Array.from({ length: n }, (_, i) => START / 1000 + i * 3600),
    weather_code: [0, 61, 95, 3].slice(0, n),
    precipitation: [0, 1, 4, 0].slice(0, n),
    snowfall: [0, 0, 0, 0].slice(0, n),
    cloud_cover: [10, 90, 100, 50].slice(0, n),
    wind_speed_10m: [5, 15, 45, 20].slice(0, n),
    temperature_2m: [10, 9, 7, null].slice(0, n),
  },
})

describe('real weather', () => {
  it('reads a place, rounded; refuses what is no place', () => {
    expect(parsePlace({ success: true, city: 'Где-то', latitude: 12.3456, longitude: '-98.7654' }, 0.1)).toEqual({ lat: 12.3, lon: -98.8, name: 'Где-то' })
    expect(parsePlace({ latitude: 12.3456, longitude: 5 }, 0.25)).toEqual({ lat: 12.25, lon: 5, name: '' })
    for (const bad of [
      null,
      'x',
      {},
      { success: false, latitude: 1, longitude: 1 },
      { latitude: 99, longitude: 1 },
      { latitude: '', longitude: 1 },
      { latitude: 37, longitude: -97, accuracy: 1000 },
    ])
      expect(parsePlace(bad, 0.1)).toBeNull()
  })
  it('reads the hours and what is between them', () => {
    const h = parseHourly(answer())!
    expect(momentAt(h, START + HOUR / 2)).toMatchObject({ code: 0, rain: 0.5, cloud: 50, wind: 10 })
    expect(momentAt(h, START + 3 * HOUR + 1)!.temp).toBe(0) // a gap in the data
    expect(momentAt(h, START - 1)).toBeNull()
    expect(momentAt(h, START + 4 * HOUR)).toBeNull()
    expect(parseHourly({ hourly: { time: [1] } })).toBeNull()
    expect(parseHourly({ hourly: { ...answer().hourly, snowfall: [] } })).toBeNull()
    expect(parseHourly('<html>')).toBeNull()
  })
  it('knows the weather of a code and the days it rained', () => {
    const t = [
      { id: 'clear', codes: [0] },
      { id: 'rain', codes: [61, 63] },
      { id: 'storm', codes: [95] },
    ]
    expect([0, 3, 61, 65, 97].map((c) => typeFor(t, c)!.id)).toEqual(['clear', 'clear', 'rain', 'rain', 'storm'])
    const days = rainyDays(parseHourly(answer())!, (c) => c >= 51, START + 4 * HOUR)
    expect([...days.values()].some(Boolean)).toBe(true)
    expect([...rainyDays(parseHourly(answer())!, (c) => c >= 51, START).values()]).toEqual([false]) // hours ahead don't count
  })
  it('every code the services use has a weather in the shipped types', () => {
    const files = import.meta.glob<string>('../content/weather/weather.types.json5', { query: '?raw', import: 'default', eager: true })
    const shipped = JSON5.parse(Object.values(files)[0]!) as Array<{ id: string; codes: number[] }>
    const codes = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]
    expect(codes.filter((c) => !shipped.some((t) => t.codes.includes(c)))).toEqual([])
    const all = shipped.flatMap((t) => t.codes)
    expect(new Set(all).size).toBe(all.length)
  })

  const make = (ask: (url: string) => unknown) => {
    let kept: unknown = null
    const asked: string[] = []
    const store = { read: () => kept, write: (v: unknown) => void (kept = v) }
    const cfg = {
      placeUrls: ['https://a.test', 'https://b.test'],
      forecastUrl: 'https://f.test?{lat},{lon}',
      placeStep: 0.1,
      placeHours: 24,
      retryMinutes: 10,
      timeout: 5,
    }
    const create = () =>
      new LiveWeather(
        cfg,
        store,
        async (url) => (asked.push(url), ask(url)),
        () => {},
      )
    return { create, asked, kept: () => kept }
  }
  it('asks once an hour, keeps the place for a day and sends only the rounded one', async () => {
    const m = make((url) => (url.includes('a.test') ? { latitude: 50.123456, longitude: 8.987654 } : answer()))
    const w = m.create()
    expect(w.due(START)).toBe(true)
    expect(await w.update(START)).toBe(true)
    expect(m.asked).toEqual(['https://a.test', 'https://f.test?50.1,9'])
    expect(w.due(START + 60_000)).toBe(false)
    expect(w.due(START + 2 * HOUR)).toBe(true)
    await w.update(START + 2 * HOUR)
    expect(m.asked.slice(2)).toEqual(['https://f.test?50.1,9'])
    await w.update(START + 25 * HOUR)
    expect(m.asked.slice(3)).toEqual(['https://a.test', 'https://f.test?50.1,9'])
    const again = m.create() // the next start of the game
    expect(again.place).toEqual({ lat: 50.1, lon: 9, name: '' })
    expect(again.hourly).not.toBeNull()
    again.forget()
    expect(m.kept()).toBeNull()
    expect(again.hourly).toBeNull()
  })
  it('tries the next service, and waits after a failure', async () => {
    const down = vi.fn()
    const m = make((url) => {
      if (url.includes('a.test')) throw new Error('down')
      if (url.includes('b.test')) return { latitude: 1, longitude: 2 }
      if (down()) return answer()
      throw new Error('no forecast')
    })
    const w = m.create()
    expect(await w.update(START)).toBe(false)
    expect(m.asked).toEqual(['https://a.test', 'https://b.test', 'https://f.test?1,2'])
    expect(w.due(START + 5 * 60_000)).toBe(false)
    expect(w.due(START + 11 * 60_000)).toBe(true)
    down.mockReturnValue(true)
    expect(await w.update(START + 11 * 60_000)).toBe(true)
  })
})
