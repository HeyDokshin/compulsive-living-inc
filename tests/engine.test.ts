import { describe, expect, it, vi } from 'vitest'
import { Entities } from '../src/engine/ecs/Entities'
import { EventBus } from '../src/engine/events/EventBus'
import { Hooks } from '../src/engine/events/Hooks'
import { Registry } from '../src/engine/registry/Registry'
import { Blockers } from '../src/engine/world/Blockers'
import { fromCorner, Interiors, legacyCorners, originOf, ROOMS_FROM } from '../src/engine/world/Interiors'
import { VoxelWorld } from '../src/engine/world/VoxelWorld'
import { WorldService } from '../src/engine/world/WorldService'
import type { BlockDef, GameEvents, GameHooks, PrefabDef } from '../src/engine/types'
import type { WorldGenStep } from '../src/engine/world/WorldGen'

describe('Hooks', () => {
  it('taps may come and go while a hook runs', () => {
    const h = new Hooks<{ x: { value: number; ctx: null } }>()
    const off: Array<() => void> = []
    off.push(h.tap('x', (v) => (off[1]!(), v + 1)))
    off.push(h.tap('x', (v) => v + 10))
    expect(h.run('x', 0, null)).toBe(11) // this run still sees both
    expect(h.run('x', 0, null)).toBe(1)
    off[0]!()
    expect(h.run('x', 0, null)).toBe(0)
  })
})

describe('Blockers', () => {
  it('finds a building from any cell, also after it moved', () => {
    const ents = new Entities(new Registry<PrefabDef>('prefabs'), new EventBus<GameEvents>(), new Hooks<GameHooks>())
    const b = new Blockers(ents)
    const e = ents.spawn({ transform: { x: 5, y: 2, z: 5, rotY: 0 }, blocker: { w: 2, d: 2, h: 3 } })
    expect(b.at(4, 4)).toBe(e)
    expect(b.at(5, 5)).toBe(e)
    expect(b.at(6, 5)).toBeUndefined()
    expect(b.isBlocked(4, 3, 5)).toBe(true)
    expect(b.isBlocked(4, 9, 5)).toBe(false)
    e.transform!.x = 12
    b.update(e)
    expect(b.at(4, 4)).toBeUndefined()
    expect(b.at(11, 4)).toBe(e)
  })
})

describe('Interiors', () => {
  it('puts each room in a world of its own, far off the island, and finds rooms by point', () => {
    const i = new Interiors()
    const a = i.area('a:one')
    const b = i.area('a:two')
    expect(a.x).toBeGreaterThanOrEqual(ROOMS_FROM)
    expect(b.x).toBeGreaterThan(a.x + a.w) // side by side, never overlapping
    expect(i.area('a:one')).toEqual(a)
    expect(i.roomAt(b.x + 1, b.z + 1)).toBe('a:two')
    expect(i.roomAt(a.x + 1, a.z + 1)).toBe('a:one')
    expect(i.roomAt(120, 3)).toBeNull() // the island
    const j = new Interiors()
    j.load(i.save())
    expect(j.area('a:two')).toEqual(b)
    expect(originOf(0).x).toBe(ROOMS_FROM)
  })

  it('moves old corner rooms into their own worlds', () => {
    const corners = legacyCorners({ current: null, slots: { 'a:house': 1 } }, 8, 8)
    expect(corners).toEqual([{ id: 'a:house', box: { x: 112, z: 0, w: 16, d: 16 } }])
    const area = new Interiors().area('a:house')
    expect(fromCorner(corners[0]!.box, area, 112 + 5.5, 7.5)).toEqual({ x: area.x + 5.5, z: area.z + 7.5 })
  })

  it('keeps the rooms where plugins found them when a save comes in', () => {
    const i = new Interiors()
    const house = i.area('a:house') // plugins ask while loading…
    i.load({ current: null }) // …an old save without room numbers changes nothing
    expect(i.area('a:house')).toEqual(house)
    i.load({ current: null, rooms: { 'a:museum': 0 } }) // a save that put another room there
    expect(i.area('a:museum').x).toBe(house.x)
    expect(i.area('a:house').x).not.toBe(house.x)
  })

  it('keeps the way back to the island when going from room to room', () => {
    const i = new Interiors()
    i.enter('a:one', { x: 1, y: 2, z: 3, rotY: 0 })
    i.enter('a:two', { x: 9, y: 9, z: 9, rotY: 0 })
    expect(i.exit()).toEqual({ x: 1, y: 2, z: 3, rotY: 0 })
  })
})

describe('WorldService', () => {
  it('regenerates when steps changed — unless the island must stay', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const steps = new Registry<WorldGenStep>('worldgen')
    const run = vi.fn()
    const add = () => steps.register({ id: 't:step', order: 1, run: () => run() } as WorldGenStep, 'test')
    add()
    const w = new WorldService(
      { seed: 1, chunksX: 1, chunksZ: 1, height: 8 } as never,
      new Registry<BlockDef>('blocks'),
      steps,
      new EventBus<GameEvents>(),
      new Hooks<GameHooks>(),
    )
    await w.regenerate()
    steps.removeOwner('test')
    add() // the same step from reloaded code
    w.acceptSteps()
    expect(await w.regenerateIfStepsChanged()).toBe(false)
    expect(run).toHaveBeenCalledTimes(1)
    steps.removeOwner('test')
    add()
    expect(await w.regenerateIfStepsChanged()).toBe(true)
  })
})

describe('VoxelWorld origin', () => {
  it('answers in world coordinates wherever the world lies', () => {
    const v = new VoxelWorld()
    v.reset(2, 2, 8)
    v.setOrigin(2048, 2048)
    expect(v.inBounds(0, 0, 0)).toBe(false)
    expect(v.inBounds(2048, 0, 2048)).toBe(true)
    expect(v.setId(2050, 1, 2060, 'a:stone')).toBe(true)
    expect(v.getId(2050, 1, 2060)).toBe('a:stone')
    expect(v.get(2, 1, 12)).toBe(0)
    expect(v.surfaceY(2050, 2060)).toBe(2)
  })
})
