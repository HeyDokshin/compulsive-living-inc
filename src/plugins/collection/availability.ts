/** When and where a species can be found (pure: no game state, tested in tests/collection.test.ts). */

export interface Habitat {
  place: string[]
  /** 1–12, northern hemisphere; empty = all year. */
  months: number[]
  /** [from, to) in hours, wrapping over midnight; undefined = all day. */
  hours?: [number, number]
  weather: 'any' | 'rain' | 'dry'
  rarity: number
}

export interface Conditions {
  /** 0–11, as in GameDate.month. */
  month: number
  /** 0–24, fractional. */
  hour: number
  raining: boolean
  hemisphere: 'north' | 'south'
}

/** Is a 1–12 month list active in a 0–11 calendar month? The south is shifted by half a year. */
export function monthOk(months: number[], month0: number, hemisphere: 'north' | 'south'): boolean {
  if (!months.length) return true
  const m = hemisphere === 'south' ? ((month0 + 6) % 12) + 1 : month0 + 1
  return months.includes(m)
}

/** Is `hour` inside [from, to)? Wraps over midnight when from > to; from == to means all day. */
export function hourOk(hours: [number, number] | undefined, hour: number): boolean {
  if (!hours) return true
  const [from, to] = hours
  if (from === to) return true
  return from < to ? hour >= from && hour < to : hour >= from || hour < to
}

export function isAvailable(h: Habitat, c: Conditions, place?: string): boolean {
  if (place !== undefined && !h.place.includes(place)) return false
  if (h.weather === 'rain' && !c.raining) return false
  if (h.weather === 'dry' && c.raining) return false
  return monthOk(h.months, c.month, c.hemisphere) && hourOk(h.hours, c.hour)
}

/** Pick one entry by weight (`weights[rarity - 1]`); `rand` returns [0, 1). */
export function pickByRarity<T extends { rarity: number }>(list: readonly T[], weights: readonly number[], rand: () => number): T | undefined {
  let total = 0
  for (const s of list) total += weights[Math.min(weights.length, Math.max(1, s.rarity)) - 1] ?? 1
  if (total <= 0) return undefined
  let r = rand() * total
  for (const s of list) {
    r -= weights[Math.min(weights.length, Math.max(1, s.rarity)) - 1] ?? 1
    if (r < 0) return s
  }
  return list[list.length - 1]
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

/** "круглый год", "сен–дек", "мар–июн, сен–окт" — for the encyclopedia. */
export function describeMonths(months: number[]): string {
  if (!months.length || months.length >= 12) return 'круглый год'
  const set = new Set(months)
  const runs: Array<[number, number]> = []
  // start each run at a month whose previous month is not in the set (handles wrap over the new year)
  for (let m = 1; m <= 12; m++) {
    if (!set.has(m) || set.has(m === 1 ? 12 : m - 1)) continue
    let end = m
    while (set.has(end === 12 ? 1 : end + 1) && (end === 12 ? 1 : end + 1) !== m) end = end === 12 ? 1 : end + 1
    runs.push([m, end])
  }
  return runs.map(([a, b]) => (a === b ? MONTHS[a - 1] : `${MONTHS[a - 1]}–${MONTHS[b - 1]}`)).join(', ')
}

export function describeHours(hours: [number, number] | undefined): string {
  if (!hours || hours[0] === hours[1]) return 'весь день'
  const f = (h: number) => `${String(h % 24).padStart(2, '0')}:00`
  return `${f(hours[0])}–${f(hours[1])}`
}
