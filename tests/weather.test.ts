import { describe, expect, it } from 'vitest'
import { rainedOn, weatherAt } from '../src/plugins/weather/forecast'

const types = [
  { id: 'clear', weights: { spring: 4, summer: 6, autumn: 3, winter: 3 } },
  { id: 'rain', weights: { spring: 2, summer: 1, autumn: 2, winter: 0 }, waters: true },
  { id: 'snow', weights: { winter: 3 } },
]

describe('weather forecast', () => {
  it('is deterministic per seed, day and block, and respects seasons', () => {
    expect(weatherAt(types, 7, 100, 9, 'autumn')).toBe(weatherAt(types, 7, 100, 11, 'autumn')) // same block
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
