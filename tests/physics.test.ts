import { describe, expect, it } from 'vitest'
import { boxHits, canStand, gaitOf, moveBody, steer, type Body, type WorldQuery } from '../src/plugins/player/physics'

/** Tiny world: ground height per column (solid below), optional water columns. */
function world(heights: Record<string, number>, water = new Set<string>(), base = 1): WorldQuery {
  const h = (x: number, z: number) => heights[`${x},${z}`] ?? base
  return {
    solid: (x, y, z) => !water.has(`${x},${z}`) && y < h(x, z),
    liquid: (x, y, z) => water.has(`${x},${z}`) && y < h(x, z),
  }
}
const shape = { radius: 0.3, height: 1.3 }
const rules = { step: 1, maxDrop: 1, gravity: 30, waterBlocks: true }
const body = (x: number, y: number, z: number): Body => ({ x, y, z, vy: 0, grounded: true })

function walk(b: Body, q: WorldQuery, dx: number, dz: number, ticks: number) {
  for (let i = 0; i < ticks; i++) moveBody(b, shape, rules, q, dx, dz, 0.05)
}

describe('player physics', () => {
  it('walks on flat ground and stays grounded', () => {
    const b = body(0.5, 1, 0.5)
    walk(b, world({}), 0.1, 0, 20)
    expect(b.x).toBeCloseTo(2.5)
    expect(b.y).toBe(1)
    expect(b.grounded).toBe(true)
  })

  it('steps up one block but not two', () => {
    const one = body(0.5, 1, 0.5)
    walk(one, world({ '2,0': 2, '3,0': 2, '4,0': 2 }), 0.1, 0, 30)
    expect(one.y).toBe(2)
    expect(one.x).toBeGreaterThan(3)

    const two = body(0.5, 1, 0.5)
    walk(two, world({ '2,0': 3 }), 0.1, 0, 30)
    expect(two.y).toBe(1)
    expect(two.x).toBeLessThan(2 - 0.3 + 1e-3)
  })

  it('refuses to walk off a high ledge, but steps down one block', () => {
    const high = body(0.5, 4, 0.5)
    walk(high, world({ '0,0': 4, '1,0': 4 }, new Set(), 1), 0.1, 0, 30)
    expect(high.y).toBe(4)
    expect(high.x).toBeLessThan(2)

    const low = body(0.5, 2, 0.5)
    walk(low, world({ '0,0': 2, '1,0': 2 }, new Set(), 1), 0.1, 0, 40)
    expect(low.y).toBe(1)
    expect(low.x).toBeGreaterThan(2)
  })

  it('does not wade into water and slides along walls', () => {
    const b = body(0.5, 1, 0.5)
    walk(b, world({ '2,0': 1 }, new Set(['2,0'])), 0.1, 0, 30)
    expect(b.x).toBeLessThan(2)
    // diagonal into a wall on x: still moves along z
    const s = body(0.5, 1, 0.5)
    walk(s, world({ '1,0': 5, '1,1': 5, '1,2': 5, '1,3': 5 }), 0.1, 0.1, 20)
    expect(s.x).toBeLessThan(1)
    expect(s.z).toBeGreaterThan(2)
  })

  it('falls with gravity and lands', () => {
    const b: Body = { x: 0.5, y: 5, z: 0.5, vy: 0, grounded: false }
    walk(b, world({}), 0, 0, 40)
    expect(b.y).toBe(1)
    expect(b.grounded).toBe(true)
  })

  it('helpers', () => {
    const q = world({ '1,0': 3 })
    expect(boxHits(q, shape, 0.5, 1, 0.5)).toBe(false)
    expect(boxHits(q, shape, 0.8, 1, 0.5)).toBe(true)
    expect(canStand(q, rules, 0.5, 1, 0.5)).toBe(true)
    expect(canStand(q, rules, 0.5, 3, 0.5)).toBe(false)
  })
})

describe('steering and gait', () => {
  const r = { acceleration: 6, deceleration: 9, turnRate: 9 }
  const run = (v: { vx: number; vz: number }, tx: number, tz: number, t: number) => {
    for (let i = 0; i < t / 0.02; i++) steer(v, tx, tz, r, 0.02)
  }

  it('eases up to the wanted speed and down to a stop without sliding on', () => {
    const v = { vx: 0, vz: 0 }
    steer(v, 2.4, 0, r, 0.02)
    expect(v.vx).toBeGreaterThan(0)
    expect(v.vx).toBeLessThan(0.5) // a gentle start
    run(v, 2.4, 0, 1.5)
    expect(v.vx).toBeCloseTo(2.4, 1)
    run(v, 0, 0, 1)
    expect(Math.hypot(v.vx, v.vz)).toBeLessThan(0.01)
  })

  it('turns to a new direction in an arc, keeping its speed', () => {
    const v = { vx: 2.4, vz: 0 }
    steer(v, 0, 2.4, r, 0.02)
    expect(v.vx).toBeGreaterThan(2) // still mostly heading on…
    expect(v.vz).toBeGreaterThan(0) // …but already bending
    expect(Math.hypot(v.vx, v.vz)).toBeGreaterThan(2.3)
    run(v, 0, 2.4, 0.4)
    expect(v.vz).toBeCloseTo(2.4, 1)
    expect(Math.abs(v.vx)).toBeLessThan(0.05)
  })

  it('brakes while turning right around', () => {
    const v = { vx: 2.4, vz: 0 }
    run(v, -2.4, 0, 0.1)
    expect(Math.hypot(v.vx, v.vz)).toBeLessThan(1.6)
    run(v, -2.4, 0, 1.5)
    expect(v.vx).toBeCloseTo(-2.4, 1)
  })

  it('names the gait by speed: standing and creeping are sneaking', () => {
    expect(gaitOf(0, 1.2, 2.4)).toBe('sneak')
    expect(gaitOf(1.2, 1.2, 2.4)).toBe('sneak')
    expect(gaitOf(2.4, 1.2, 2.4)).toBe('walk')
    expect(gaitOf(4.4, 1.2, 2.4)).toBe('run')
  })
})
