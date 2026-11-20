import { describe, expect, it } from 'vitest'
import { have, plan, tally, type HasTag } from '../src/plugins/crafting/recipes'
import { demand, formatDemand } from '../src/plugins/economy/market'
import { pickDaily } from '../src/plugins/shop/stock'

const tags: Record<string, string[]> = { 'garden:rose_red': ['garden:flowers'], 'garden:tulip_white': ['garden:flowers'], 'core:apple': ['core:fruits'] }
const hasTag: HasTag = (id, tag) => !!tags[id]?.includes(tag.replace('#', ''))

describe('recipes', () => {
  const pocket = tally([
    { id: 'core:wood', count: 3 },
    { id: 'core:wood', count: 2 },
    { id: 'garden:rose_red', count: 1 },
    { id: 'garden:tulip_white', count: 2 },
    null,
  ])

  it('counts items and tags across stacks', () => {
    expect(pocket.get('core:wood')).toBe(5)
    expect(have({ tag: '#garden:flowers', count: 2 }, pocket, hasTag)).toBe(3)
  })

  it('plans what to take, or says what is missing', () => {
    expect(plan([{ item: 'core:wood', count: 4 }], pocket, hasTag)).toEqual([['core:wood', 4]])
    expect(plan([{ item: 'core:wood', count: 6 }], pocket, hasTag)).toBeNull()
    const p = plan([{ tag: '#garden:flowers', count: 3 }], pocket, hasTag)!
    expect(p.reduce((s, [, n]) => s + n, 0)).toBe(3)
    expect(plan([{ tag: '#garden:flowers', count: 2 }], pocket, hasTag, 2)).toBeNull() // only 3 flowers
  })

  it('lets exact items go first so a tag cannot eat them', () => {
    // needs the red rose itself plus 2 flowers of any kind: only works if the rose is kept for the first
    const p = plan([{ tag: '#garden:flowers', count: 2 }, { item: 'garden:rose_red', count: 1 }], pocket, hasTag)
    expect(p).not.toBeNull()
    expect(Object.fromEntries(p!)).toEqual({ 'garden:rose_red': 1, 'garden:tulip_white': 2 })
  })
})

describe('market', () => {
  const fish = { id: 'economy:fish', amplitude: 0.35 }
  it('is deterministic, bounded and moves over the week', () => {
    expect(demand(42, 100, fish)).toBe(demand(42, 100, fish))
    const week = Array.from({ length: 14 }, (_, d) => demand(42, 100 + d, fish))
    for (const m of week) {
      expect(m).toBeGreaterThanOrEqual(0.6)
      expect(m).toBeLessThanOrEqual(1.4)
    }
    expect(new Set(week).size).toBeGreaterThan(3)
    const other = Array.from({ length: 14 }, (_, d) => demand(43, 100 + d, fish))
    expect(other).not.toEqual(week) // another island, other prices
  })
  it('formats', () => {
    expect(formatDemand(1.3)).toBe('+30%')
    expect(formatDemand(0.85)).toBe('−15%')
    expect(formatDemand(1)).toBe('±0%')
  })
})

describe('shop stock', () => {
  const pool = ['a', 'b', 'c', 'd', 'e']
  it('picks distinct goods, the same all day, different on other days', () => {
    const today = pickDaily(pool, 3, 7, 200, 'decor')
    expect(new Set(today).size).toBe(3)
    expect(pickDaily(pool, 3, 7, 200, 'decor')).toEqual(today)
    const days = new Set(Array.from({ length: 10 }, (_, d) => pickDaily(pool, 3, 7, 200 + d, 'decor').join()))
    expect(days.size).toBeGreaterThan(3)
    expect(pickDaily(pool, 9, 7, 200, 'decor').length).toBe(5)
  })
})
