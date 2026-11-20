import { describe, expect, it } from 'vitest'
import { describeHours, describeMonths, hourOk, isAvailable, monthOk, pickByRarity, type Habitat } from '../src/plugins/collection/availability'
import { judgeReel, planBite } from '../src/plugins/fishing/bite'
import { WATER_POND, WATER_RIVER, waterKindAt } from '../src/plugins/terrain/gen'
import { Blockers } from '../src/engine/world/Blockers'
import { Entities } from '../src/engine/ecs/Entities'
import { Registry } from '../src/engine/registry/Registry'
import { EventBus } from '../src/engine/events/EventBus'
import { Hooks } from '../src/engine/events/Hooks'
import type { GameEvents, GameHooks, PrefabDef } from '../src/engine/types'

const habitat = (h: Partial<Habitat>): Habitat => ({ place: ['river'], months: [], weather: 'any', rarity: 1, ...h })
const cond = { month: 10, hour: 12, raining: false, hemisphere: 'north' as const } // November, noon

describe('species availability', () => {
  it('checks months per hemisphere', () => {
    expect(monthOk([], 3, 'north')).toBe(true)
    expect(monthOk([11, 12], 10, 'north')).toBe(true) // November
    expect(monthOk([11, 12], 10, 'south')).toBe(false) // November in the south is May
    expect(monthOk([5], 10, 'south')).toBe(true)
  })

  it('checks hours, wrapping over midnight', () => {
    expect(hourOk(undefined, 3)).toBe(true)
    expect(hourOk([9, 16], 15.9)).toBe(true)
    expect(hourOk([9, 16], 16)).toBe(false)
    expect(hourOk([19, 4], 23)).toBe(true)
    expect(hourOk([19, 4], 2)).toBe(true)
    expect(hourOk([19, 4], 12)).toBe(false)
    expect(hourOk([16, 24], 23.5)).toBe(true)
  })

  it('combines place, weather and time', () => {
    expect(isAvailable(habitat({}), cond, 'river')).toBe(true)
    expect(isAvailable(habitat({}), cond, 'sea')).toBe(false)
    expect(isAvailable(habitat({ weather: 'rain' }), cond)).toBe(false)
    expect(isAvailable(habitat({ weather: 'rain' }), { ...cond, raining: true })).toBe(true)
    expect(isAvailable(habitat({ weather: 'dry' }), { ...cond, raining: true })).toBe(false)
    expect(isAvailable(habitat({ months: [7, 8] }), cond)).toBe(false)
  })

  it('picks by rarity weight', () => {
    const list = [
      { id: 'common', rarity: 1 },
      { id: 'rare', rarity: 5 },
    ]
    let seed = 1
    const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
    const counts: Record<string, number> = { common: 0, rare: 0 }
    for (let i = 0; i < 2000; i++) counts[pickByRarity(list, [10, 6, 3, 1.4, 0.5], rand)!.id]!++
    expect(counts.common! / 2000).toBeGreaterThan(0.9)
    expect(counts.rare).toBeGreaterThan(0)
    expect(pickByRarity([], [1], rand)).toBeUndefined()
  })

  it('describes seasons and hours for the encyclopedia', () => {
    expect(describeMonths([])).toBe('круглый год')
    expect(describeMonths([9, 10, 11, 12])).toBe('сен–дек')
    expect(describeMonths([11, 12, 1, 2])).toBe('ноя–фев')
    expect(describeMonths([3, 4, 5, 6, 9, 10])).toBe('мар–июн, сен–окт')
    expect(describeHours([19, 4])).toBe('19:00–04:00')
    expect(describeHours(undefined)).toBe('весь день')
  })
})

describe('fishing bites', () => {
  it('plans nibbles before the bite within the rules', () => {
    const rules = { minNibbles: 1, maxNibbles: 3, gapMin: 0.5, gapMax: 1 }
    for (let i = 0; i < 50; i++) {
      const plan = planBite(rules, Math.random)
      expect(plan.nibbles.length).toBeGreaterThanOrEqual(1)
      expect(plan.nibbles.length).toBeLessThanOrEqual(3)
      const times = [...plan.nibbles, plan.biteAt]
      for (let k = 1; k < times.length; k++) {
        const gap = times[k]! - times[k - 1]!
        expect(gap).toBeGreaterThanOrEqual(0.5)
        expect(gap).toBeLessThanOrEqual(1)
      }
    }
  })

  it('judges the reel: early, in the window, late', () => {
    expect(judgeReel(2.9, 3, 0.8)).toBe('early')
    expect(judgeReel(3, 3, 0.8)).toBe('hit')
    expect(judgeReel(3.8, 3, 0.8)).toBe('hit')
    expect(judgeReel(3.81, 3, 0.8)).toBe('late')
  })
})

describe('water kinds', () => {
  it('tells rivers, ponds and the sea apart', () => {
    const land = new Uint8Array([0, 1, 1, 1])
    const river = new Uint8Array([0, WATER_RIVER, WATER_POND, 0])
    expect(waterKindAt({ land, river }, 0)).toBe('sea')
    expect(waterKindAt({ land, river }, 1)).toBe('river')
    expect(waterKindAt({ land, river }, 2)).toBe('pond')
  })
})

describe('blockers', () => {
  it('index multi-cell footprints and follow despawns', () => {
    const entities = new Entities(new Registry<PrefabDef>('prefabs'), new EventBus<GameEvents>(), new Hooks<GameHooks>())
    const blockers = new Blockers(entities)
    const tree = entities.spawn({ transform: { x: 3.5, y: 10, z: 3.5, rotY: 0 }, blocker: { w: 1, d: 1, h: 3 } })
    const hall = entities.spawn({ transform: { x: 12.5, y: 10, z: 22.5, rotY: 0 }, blocker: { w: 5, d: 5, h: 6 } })
    expect(blockers.at(3, 3)).toBe(tree)
    expect(blockers.at(4, 3)).toBeUndefined()
    // 5×5 around (12.5, 22.5): x 10..14, z 20..24
    expect(blockers.at(10, 20)).toBe(hall)
    expect(blockers.at(14, 24)).toBe(hall)
    expect(blockers.at(15, 24)).toBeUndefined()
    expect(blockers.isBlocked(12, 10, 22)).toBe(true)
    expect(blockers.isBlocked(12, 17, 22)).toBe(false) // above the roof
    entities.despawn(hall)
    expect(blockers.at(12, 22)).toBeUndefined()
    expect(blockers.at(3, 3)).toBe(tree)
  })
})
