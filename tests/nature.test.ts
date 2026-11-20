import { describe, expect, it } from 'vitest'
import { chop, liveDay, newTree, shake } from '../src/plugins/nature/growth'

describe('tree growth', () => {
  it('grows sapling → young → grown every 2 days, then bears fruit after 3 more', () => {
    const t = newTree('apple', 100, 0, true)
    const stages: number[] = []
    for (let d = 101; d <= 108; d++) {
      liveDay(t, d, true)
      stages.push(t.stage * 10 + t.fruit)
    }
    expect(stages).toEqual([0, 10, 10, 20, 20, 20, 23, 23])
  })

  it('shaking drops all fruit and they grow back in 3 days; oaks never fruit', () => {
    const t = newTree('apple', 10, 2, true)
    expect(t.fruit).toBe(3)
    expect(shake(t, 10)).toBe(3)
    expect(shake(t, 10)).toBe(0)
    for (let d = 11; d <= 12; d++) liveDay(t, d, true)
    expect(t.fruit).toBe(0)
    liveDay(t, 13, true)
    expect(t.fruit).toBe(3)
    const oak = newTree('oak', 10, 2, false)
    for (let d = 11; d <= 20; d++) liveDay(oak, d, false)
    expect(oak.fruit).toBe(0)
  })

  it('gives 3 wood a day', () => {
    const t = newTree('oak', 1, 2, false)
    expect([chop(t, 1), chop(t, 1), chop(t, 1), chop(t, 1)]).toEqual([true, true, true, false])
    expect(chop(t, 2)).toBe(true)
    expect(chop(newTree('oak', 1, 0, false), 1)).toBe(false)
  })
})

import { breedColor } from '../src/plugins/garden/genetics'

describe('flower genetics', () => {
  const rules = [
    { a: 'red', b: 'white', child: 'pink', chance: 0.5 },
    { a: 'white', b: 'white', child: 'purple', chance: 0.25 },
  ]
  it('gives the special color by its chance, otherwise a parent color (order of parents ignored)', () => {
    let s = 1
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    const kids = Array.from({ length: 1000 }, () => breedColor(rules, 'white', 'red', rand))
    const pink = kids.filter((k) => k === 'pink').length
    expect(pink).toBeGreaterThan(400)
    expect(pink).toBeLessThan(600)
    expect(kids.every((k) => ['pink', 'red', 'white'].includes(k))).toBe(true)
    const yellow = Array.from({ length: 50 }, () => breedColor(rules, 'yellow', 'yellow', rand))
    expect(new Set(yellow)).toEqual(new Set(['yellow']))
  })
})
