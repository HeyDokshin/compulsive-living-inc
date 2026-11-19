import { describe, expect, it, vi } from 'vitest'
import { EventBus } from '../src/engine/events/EventBus'
import { Hooks } from '../src/engine/events/Hooks'

describe('EventBus', () => {
  it('delivers, unsubscribes and isolates failing handlers', () => {
    const bus = new EventBus<{ ping: { n: number } }>()
    const got: number[] = []
    vi.spyOn(console, 'error').mockImplementation(() => {})
    bus.on('ping', () => {
      throw new Error('boom')
    })
    const off = bus.on('ping', (p) => got.push(p.n))
    bus.emit('ping', { n: 1 })
    off()
    bus.emit('ping', { n: 2 })
    expect(got).toEqual([1])
  })
})

describe('Hooks', () => {
  it('runs taps in priority order as a waterfall', () => {
    const hooks = new Hooks<{ price: { value: number; ctx: { item: string } } }>()
    hooks.tap('price', (v) => v * 2, { priority: 10 })
    const off = hooks.tap('price', (v) => v + 1)
    expect(hooks.run('price', 10, { item: 'x' })).toBe(22)
    off()
    expect(hooks.run('price', 10, { item: 'x' })).toBe(20)
  })
})
