import { describe, expect, it } from 'vitest'
import { pickCurved, raycastVoxels } from '../src/engine/world/pick'
import { findPath, lineWalkable } from '../src/engine/world/path'

const ground = (x: number, y: number, z: number) => y < 2 || (x === 5 && z === 5 && y < 4)

describe('voxel picking', () => {
  it('finds the first solid cell along a ray and the entry face', () => {
    const h = raycastVoxels({ x: 0.5, y: 10, z: 0.5 }, { x: 0, y: -1, z: 0 }, ground, 50)
    expect(h).toMatchObject({ x: 0, y: 1, z: 0, face: [0, 1, 0] })
    const d = { x: 0.6, y: -0.6, z: 0.6 }
    const len = Math.hypot(d.x, d.y, d.z)
    const tower = raycastVoxels({ x: 0.5, y: 8.5, z: 0.5 }, { x: d.x / len, y: d.y / len, z: d.z / len }, ground, 50)
    expect(tower).toMatchObject({ x: 5, z: 5 }) // hits the tower before the floor
    expect(raycastVoxels({ x: 0.5, y: 10, z: 0.5 }, { x: 0, y: 1, z: 0 }, ground, 20)).toBe(null)
  })

  it('corrects for world curvature (the screen shows points lowered by k·d²)', () => {
    const k = 0.01
    const curve = { k, center: { x: 0, y: 0, z: 0 }, forward: { x: 1, z: 0 } }
    // A flat floor at y = 2. The cell at x = 20 is drawn 4 blocks lower (y = -2).
    // A vertical ray through the drawn point (x = 20.5, coming down to y = -2) must pick x = 20.
    const drawnY = 2 - k * 20.5 * 20.5
    const h = pickCurved({ x: 20.5, y: drawnY + 0.01, z: 0.5 }, { x: 0, y: -1, z: 0 }, (_x, y) => y < 2, 50, curve)
    expect(h).toMatchObject({ x: 20, y: 1 })
  })
})

describe('click-to-walk path', () => {
  it('goes around walls, uses diagonals only past free corners, stops next to the target', () => {
    const wall = new Set(['3,0', '3,1', '3,2', '3,3'])
    const free = (c: { x: number; z: number }) => c.x >= 0 && c.z >= 0 && c.x < 8 && c.z < 8 && !wall.has(`${c.x},${c.z}`)
    const target = { x: 6, z: 1 }
    const path = findPath({ x: 0, z: 1 }, { canStep: (_a, b) => free(b), isGoal: (c) => Math.abs(c.x - target.x) + Math.abs(c.z - target.z) === 1, target })!
    expect(path).not.toBe(null)
    expect(path.every(free)).toBe(true)
    const last = path[path.length - 1]!
    expect(Math.abs(last.x - 6) + Math.abs(last.z - 1)).toBe(1)
    expect(path.some((c) => c.z >= 4)).toBe(true) // had to go around the wall
  })

  it('returns null when unreachable', () => {
    const p = findPath({ x: 0, z: 0 }, { canStep: (_a, b) => b.x < 2, isGoal: (c) => c.x === 5, target: { x: 5, z: 0 }, maxNodes: 200 })
    expect(p).toBe(null)
  })
})

describe('straight lines for click-to-walk', () => {
  const wall = new Set(['3,0', '3,1', '3,2'])
  const free = (c: { x: number; z: number }) => c.x >= 0 && c.z >= 0 && c.x < 8 && c.z < 8 && !wall.has(`${c.x},${c.z}`)
  const canStep = (_a: { x: number; z: number }, b: { x: number; z: number }) => free(b)

  it('sees across open ground, diagonals included', () => {
    expect(lineWalkable(0.5, 5.5, 7.5, 5.5, 0.3, canStep)).toBe(true)
    expect(lineWalkable(0.5, 7.5, 6.5, 3.5, 0.3, canStep)).toBe(true)
  })

  it('is blocked by a wall, and by a corner the body would scrape', () => {
    expect(lineWalkable(0.5, 1.5, 6.5, 1.5, 0.3, canStep)).toBe(false)
    // passes the wall end (3,2) at 0.1 of a block: the body (0.3) would hit it
    expect(lineWalkable(2.5, 3.6, 4.5, 2.95, 0.3, canStep)).toBe(false)
    // clear of the wall end
    expect(lineWalkable(1.5, 4.5, 5.5, 4.5, 0.3, canStep)).toBe(true)
  })

  it('respects the step rule between columns (heights)', () => {
    const h = (c: { x: number; z: number }) => (c.x >= 4 ? 3 : 1)
    const step = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.abs(h(a) - h(b)) <= 1
    expect(lineWalkable(0.5, 0.5, 3.5, 0.5, 0.3, step)).toBe(true)
    expect(lineWalkable(0.5, 0.5, 5.5, 0.5, 0.3, step)).toBe(false)
  })
})
