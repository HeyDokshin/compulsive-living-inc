/** Calendar math for the game clock (pure). Local time of the device, like cozy island games. */

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'
export type Hemisphere = 'north' | 'south'

export interface GameDate {
  /** ms since the Unix epoch (game clock). */
  ms: number
  year: number
  /** 0–11 */
  month: number
  /** 1–31 */
  day: number
  /** 0 = Sunday … 6 = Saturday */
  weekday: number
  /** 0–24, fractional */
  hour: number
  minute: number
  /** Whole local days since the epoch: changes at local midnight. Use it to schedule "in 3 days". */
  dayIndex: number
  season: Season
}

const DAY_MS = 86_400_000

export function seasonOf(month: number, hemisphere: Hemisphere): Season {
  const north: Season[] = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter']
  const s = north[month]!
  if (hemisphere === 'north') return s
  return ({ winter: 'summer', summer: 'winter', spring: 'autumn', autumn: 'spring' } as const)[s]
}

/** Local day number: counts local midnights, so it is stable across DST changes. */
export function localDayIndex(d: Date): number {
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS)
}

export function toGameDate(ms: number, hemisphere: Hemisphere = 'north'): GameDate {
  const d = new Date(ms)
  const month = d.getMonth()
  return {
    ms,
    year: d.getFullYear(),
    month,
    day: d.getDate(),
    weekday: d.getDay(),
    hour: d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600,
    minute: d.getMinutes(),
    dayIndex: localDayIndex(d),
    season: seasonOf(month, hemisphere),
  }
}

const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
export const SEASON_NAMES: Record<Season, string> = { spring: 'весна', summer: 'лето', autumn: 'осень', winter: 'зима' }
export const SEASON_ICONS: Record<Season, string> = { spring: '🌸', summer: '☀️', autumn: '🍂', winter: '❄️' }

export function formatDate(g: GameDate): string {
  return `${WEEKDAYS[g.weekday]}, ${g.day} ${MONTHS[g.month]}`
}

export function formatTime(g: GameDate): string {
  return `${String(Math.floor(g.hour)).padStart(2, '0')}:${String(g.minute).padStart(2, '0')}`
}
