import { describe, expect, it } from 'vitest'
import { moveToWall, nearWall, payment, planRoom } from '../src/plugins/house/room'
import { fits, topmost, type Placed } from '../src/plugins/decor/layers'

describe('house room', () => {
  it('centers the room and puts the door in the front wall', () => {
    const r = planRoom(8, 8)
    expect([r.x0, r.z0]).toEqual([4, 4])
    expect(r.door).toEqual({ x: 8, z: 11 })
    expect(r.kindAt(8, 11)).toBe('door')
    expect(r.kindAt(4, 6)).toBe('wall')
    expect(r.kindAt(6, 6)).toBe('floor')
    expect(r.kindAt(2, 2)).toBe('outside')
    expect(r.spawn).toEqual({ x: 8.5, z: 10.5 })
  })
  it('bigger rooms contain smaller ones (furniture stays inside after upgrades)', () => {
    const a = planRoom(8, 8)
    const b = planRoom(12, 12)
    const floor: string[] = []
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) if (a.kindAt(x, z) === 'floor') floor.push(b.kindAt(x, z))
    expect(floor).toHaveLength(36)
    expect(new Set(floor)).toEqual(new Set(['floor']))
  })
  it('knows which walls face the camera', () => {
    const r = planRoom(8, 8)
    expect(nearWall(r.outward(11, 6), 45)).toBe(true) // +x wall, camera at +x+z
    expect(nearWall(r.outward(4, 6), 45)).toBe(false)
    expect(nearWall(r.outward(4, 6), 225)).toBe(true)
  })
  it('pays the loan within what is owed and held', () => {
    expect(payment(10000, 3000, 50000)).toBe(3000)
    expect(payment(10000, 30000, 4000)).toBe(4000)
    expect(payment(-5, 100, 100)).toBe(0)
  })
})

describe('decor layers', () => {
  const p = (layer: Placed['layer'], surface = 0, y = 0): Placed<string> => ({ layer, surface, y, ref: layer })
  it('stacks rugs, furniture, tabletop things and wall pieces', () => {
    expect(fits('floor', [p('rug')]).ok).toBe(true)
    expect(fits('floor', [p('floor')]).ok).toBe(false)
    expect(fits('rug', [p('floor')]).ok).toBe(true)
    expect(fits('rug', [p('rug')]).ok).toBe(false)
    expect(fits('top', [p('floor')]).ok).toBe(false) // a chair has no top
    const table = fits('top', [p('rug'), p('floor', 0.69, 9)])
    expect(table.ok).toBe(true)
    expect(table.on?.surface).toBe(0.69)
    expect(fits('top', [p('floor', 0.69), p('top')]).ok).toBe(false)
    expect(fits('wall', []).ok).toBe(true)
  })
  it('reaches the topmost piece first', () => {
    expect(topmost([p('rug'), p('floor', 0.69), p('top')])?.ref).toBe('top')
    expect(topmost([p('rug'), p('floor')])?.ref).toBe('floor')
  })
})

describe('terraforming', async () => {
  const { terraformOp } = await import('../src/plugins/landscaping/terraform')
  const lim = { maxUp: 2, maxDown: 1, maxHeight: 20, minHeight: 8 }
  it('raises what is level with you and lowers what stands above', () => {
    expect(terraformOp(12, 12, 12, lim)).toBe('raise')
    expect(terraformOp(13, 12, 12, lim)).toBe('lower')
  })
  it('keeps within the limits', () => {
    expect(terraformOp(14, 14, 12, lim)).toBeNull() // already +2
    expect(terraformOp(12, 11, 12, lim)).toBe('lower') // back down to the original is fine
    expect(terraformOp(11, 10, 12, lim)).toBeNull() // −1 already
    expect(terraformOp(9, 8, 9, lim)).toBeNull() // the sea level stays
  })
})

describe('a bigger room', () => {
  it('takes pictures out with the walls', () => {
    const a = planRoom(8, 8)
    const b = planRoom(10, 10)
    expect(moveToWall(a, b, 4, 6)).toEqual({ x: 3, z: 6 }) // left wall
    expect(moveToWall(a, b, 7, 4)).toEqual({ x: 7, z: 3 }) // back wall
    expect(moveToWall(a, b, 11, 9)).toEqual({ x: 12, z: 9 }) // right wall
    expect(moveToWall(a, b, 6, 6)).toBeNull() // not on a wall
  })
})
