import { describe, expect, it } from 'vitest'
import { monthly } from '../src/plugins/seasons/cover'

describe('season cover', () => {
  const snow = [0.9, 0.8, 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0.4]
  it("is the month's value in its middle and blends day by day between months", () => {
    expect(monthly(snow, 0, 16)).toBeCloseTo(0.9)
    expect(monthly(snow, 0, 31)).toBeCloseTo(0.85) // half way to February's
    expect(monthly(snow, 0, 1)).toBeCloseTo(0.4 + 0.5 * (16 / 30)) // 16 days on from the middle of December
    expect(monthly(snow, 10, 28)).toBeCloseTo(0.4 * 0.4) // late November: a little snow coming
    expect(monthly(snow, 6, 15)).toBe(0)
  })
  it('turns the year round in the south', () => {
    expect(monthly(snow, 6, 16, true)).toBeCloseTo(0.9) // July there is January here
    expect(monthly(snow, 0, 16, true)).toBe(0)
  })
})
