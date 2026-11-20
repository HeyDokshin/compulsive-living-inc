/** Is a calendar event on today? (pure, tested in tests/quests.test.ts) */

export interface When {
  /** [month 1–12, day] inclusive range; may wrap over the new year (Dec 15 → Jan 7). */
  from?: [number, number]
  to?: [number, number]
  /** 0 = Sunday … 6 = Saturday. */
  weekdays?: number[]
}

export interface Day {
  month: number // 1–12
  day: number
  weekday: number
}

const ord = (m: number, d: number) => m * 100 + d

export function isOn(w: When, today: Day): boolean {
  if (w.weekdays && !w.weekdays.includes(today.weekday)) return false
  if (w.from && w.to) {
    const t = ord(today.month, today.day)
    const a = ord(...w.from)
    const b = ord(...w.to)
    return a <= b ? t >= a && t <= b : t >= a || t <= b
  }
  return !!w.weekdays
}
