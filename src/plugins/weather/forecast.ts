/** Deterministic weather choice (pure): same island seed + day + time block → same weather. */

export interface WeatherType {
  id: string
  weights: Partial<Record<'spring' | 'summer' | 'autumn' | 'winter', number>>
  waters?: boolean
}

/** Hours per weather block (4 blocks a day). */
export const BLOCK_HOURS = 6

function hash(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b, 0xc2b2ae35) ^ Math.imul(c, 0x27d4eb2f)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

export function weatherAt<T extends WeatherType>(types: T[], seed: number, dayIndex: number, hour: number, season: keyof WeatherType['weights']): T | undefined {
  const block = Math.floor(hour / BLOCK_HOURS)
  const weighted = types.map((t) => ({ t, w: Math.max(0, t.weights[season] ?? 0) })).filter((x) => x.w > 0)
  const total = weighted.reduce((s, x) => s + x.w, 0)
  if (!total) return undefined
  // Weather tends to last: odd blocks keep the previous block's weather half of the time.
  const r0 = hash(seed, dayIndex, block)
  if (block > 0 && hash(seed + 1, dayIndex, block) < 0.5) return weatherAt(types, seed, dayIndex, (block - 1) * BLOCK_HOURS, season)
  let r = r0 * total
  for (const x of weighted) if ((r -= x.w) <= 0) return x.t
  return weighted[weighted.length - 1]!.t
}

/** Did it rain (a watering weather) at any time that day? */
export function rainedOn<T extends WeatherType>(types: T[], seed: number, dayIndex: number, season: keyof WeatherType['weights']): boolean {
  for (let h = 0; h < 24; h += BLOCK_HOURS) if (weatherAt(types, seed, dayIndex, h, season)?.waters) return true
  return false
}
