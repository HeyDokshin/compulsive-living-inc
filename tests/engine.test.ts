import { describe, expect, it, vi } from 'vitest'
import { Entities } from '../src/engine/ecs/Entities'
import { EventBus } from '../src/engine/events/EventBus'
import { Hooks } from '../src/engine/events/Hooks'
import { Registry } from '../src/engine/registry/Registry'
import { Blockers } from '../src/engine/world/Blockers'
import { Interiors } from '../src/engine/world/Interiors'
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
  it('keeps corners while the world keeps its size and follows it when it changes', () => {
    let size = { x: 8, z: 8 }
    const i = new Interiors(() => size)
    expect(i.corners()).toBe(i.corners())
    i.area('a:one')
    i.area('a:two')
    expect(i.roomAt(120, 3)).toBe('a:two')
    expect(i.pointVisible(120, 3)).toBe(false)
    i.enter('a:two', { x: 0, y: 0, z: 0, rotY: 0 })
    expect(i.pointVisible(120, 3)).toBe(true)
    expect(i.chunkVisible(0, 0)).toBe(false)
    size = { x: 4, z: 4 }
    expect(i.roomAt(60, 3)).toBe('a:two')
  })
})

describe('WorldService', () => {
  it('regenerates when steps changed — unless the island must stay', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const steps = new Registry<WorldGenStep>('worldgen')
    const run = vi.fn()
    const add = () => steps.register({ id: 't:step', order: 1, run: () => run() } as WorldGenStep, 'test')
    add()
    const w = new WorldService({ seed: 1, chunksX: 1, chunksZ: 1, height: 8 } as never, new Registry<BlockDef>('blocks'), steps, new EventBus<GameEvents>(), new Hooks<GameHooks>())
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
