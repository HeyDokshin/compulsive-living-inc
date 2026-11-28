import { describe, expect, it, vi } from 'vitest'
import { GameLoop } from '../src/engine/loop/GameLoop'
import { Scheduler } from '../src/engine/loop/Scheduler'

describe('GameLoop + Scheduler', () => {
  it('runs a fixed number of ticks and phases in order', () => {
    const s = new Scheduler()
    const calls: string[] = []
    s.add({ id: 'b', phase: 'update', priority: 5, run: () => calls.push('update:b') }, 't')
    s.add({ id: 'a', phase: 'update', priority: -5, run: () => calls.push('update:a') }, 't')
    s.add({ id: 'i', phase: 'input', run: () => calls.push('input') }, 't')
    let renders = 0
    s.add({ id: 'r', phase: 'render', run: () => renders++ }, 't')
    const loop = new GameLoop(s, { tickRate: 20 })
    expect(loop.advance(0.1)).toBe(2)
    expect(calls).toEqual(['input', 'update:a', 'update:b', 'input', 'update:a', 'update:b'])
    expect(renders).toBe(1)
  })

  it('clamps long frames, honors pause and single steps', () => {
    const loop = new GameLoop(new Scheduler(), { tickRate: 10, maxFrameTime: 0.25 })
    expect(loop.advance(5)).toBe(2)
    loop.paused = true
    expect(loop.advance(1)).toBe(0)
    loop.stepOnce()
    expect(loop.advance(1)).toBe(1)
  })

  it('disables a throwing system instead of crashing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const s = new Scheduler()
    let n = 0
    s.add(
      {
        id: 'bad',
        phase: 'update',
        run: () => {
          n++
          throw new Error('x')
        },
      },
      't',
    )
    const loop = new GameLoop(s, { tickRate: 10 })
    loop.advance(0.3)
    expect(n).toBe(1)
    expect(s.list()[0]!.enabled).toBe(false)
  })
})
