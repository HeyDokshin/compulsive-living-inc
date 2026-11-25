/** The island's own weather (pure): the same seed + day → the same 24 hours. */

export type SeasonName = 'spring' | 'summer' | 'autumn' | 'winter'

export interface WeatherType {
  id: string
  weights: Partial<Record<SeasonName, number>>
  /** Times of day that suit it: [from, to) and how many times likelier it is then. */
  hours?: Array<[number, number, number]>
  waters?: boolean
}

/** How often an hour goes on like the one before. */
const LASTS = 0.72

function hash(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b, 0xc2b2ae35) ^ Math.imul(c, 0x27d4eb2f)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

const within = (from: number, to: number, h: number) => (from <= to ? h >= from && h < to : h >= from || h < to)

/** Weight of a weather at an hour: its season's, more at the times of day that suit it. */
export function weightAt(t: WeatherType, season: SeasonName, hour: number): number {
  let w = Math.max(0, t.weights[season] ?? 0)
  for (const [from, to, times] of t.hours ?? []) if (within(from, to, hour)) w *= times
  return w
}

function pick<T extends WeatherType>(types: readonly T[], season: SeasonName, hour: number, r: number): T | undefined {
  let total = 0
  for (const t of types) total += weightAt(t, season, hour)
  if (!total) return undefined
  let left = r * total
  for (const t of types) {
    const w = weightAt(t, season, hour)
    if (w > 0 && (left -= w) <= 0) return t
  }
  return types.find((t) => weightAt(t, season, hour) > 0)
}

/** The 24 hours of a day: weather lasts a while, then changes to what suits the hour. */
export function dayWeather<T extends WeatherType>(types: readonly T[], seed: number, dayIndex: number, season: SeasonName): Array<T | undefined> {
  const out: Array<T | undefined> = []
  let now: T | undefined
  for (let h = 0; h < 24; h++) {
    const stays = now && weightAt(now, season, h) > 0 && hash(seed + 1, dayIndex, h) < LASTS
    if (!stays) now = pick(types, season, h, hash(seed, dayIndex, h))
    out.push(now)
  }
  return out
}

export function weatherAt<T extends WeatherType>(types: readonly T[], seed: number, dayIndex: number, hour: number, season: SeasonName): T | undefined {
  return dayWeather(types, seed, dayIndex, season)[Math.floor(((hour % 24) + 24) % 24)]
}

/** Did it rain (a watering weather) at any time that day? */
export function rainedOn<T extends WeatherType>(types: readonly T[], seed: number, dayIndex: number, season: SeasonName): boolean {
  return dayWeather(types, seed, dayIndex, season).some((t) => t?.waters)
}
