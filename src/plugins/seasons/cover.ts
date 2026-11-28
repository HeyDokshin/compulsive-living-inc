/** The season's cover on a day (pure, tested in tests/seasons.test.ts): monthly values blended day by day. */

/**
 * A value per month (0 = January … 11 = December) is the value in the middle of that month; days in
 * between blend from one month's to the next. The south turns the year round by half.
 */
export function monthly(values: readonly number[], month: number, day: number, south = false): number {
  const m = (month + (south ? 6 : 0)) % 12
  const at = (i: number) => values[(i + 12) % 12] ?? 0
  // before the middle: from last month's middle; after it: towards next month's
  const [a, b, k] = day < 16 ? [at(m - 1), at(m), (day + 15) / 30] : [at(m), at(m + 1), (day - 16) / 30]
  return a + (b - a) * Math.max(0, Math.min(1, k))
}
