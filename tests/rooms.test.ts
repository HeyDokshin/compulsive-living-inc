import { describe, expect, it } from 'vitest'
import { dayBlend, facesCamera, floorShade, planWalls, sideOf, wallPieces } from '../src/plugins/rooms/shell'

const box = { x0: 10, z0: 20, w: 8, d: 6 }

describe('room shell', () => {
  it('puts walls on the inner side of the ring, north and south closing the corners', () => {
    const runs = planWalls(box, [], [], 0.3)
    const by = Object.fromEntries(runs.map((r) => [r.side, r]))
    expect(by.north!.plane).toBe(21)
    expect(by.south!.plane).toBe(25)
    expect(by.west!.plane).toBe(11)
    expect(by.east!.plane).toBe(17)
    expect(by.north!.from).toBeCloseTo(10.7)
    expect(by.north!.to).toBeCloseTo(17.3)
    expect([by.west!.from, by.west!.to]).toEqual([21, 25])
  })

  it('finds the side of a ring cell and merges neighbouring openings', () => {
    expect(sideOf(box, 13, 20)).toBe('north')
    expect(sideOf(box, 10, 22)).toBe('west')
    expect(sideOf(box, 12, 22)).toBeNull()
    const runs = planWalls(
      box,
      [
        { x: 13, z: 25 },
        { x: 14, z: 25 },
      ],
      [
        { x: 12, z: 20 },
        { x: 15, z: 20 },
        { x: 10, z: 23 },
      ],
      0.3,
    )
    const by = Object.fromEntries(runs.map((r) => [r.side, r]))
    expect(by.south!.openings).toEqual([{ kind: 'door', a: 13, b: 15 }])
    expect(by.north!.openings).toEqual([
      { kind: 'window', a: 12, b: 13 },
      { kind: 'window', a: 15, b: 16 },
    ])
    expect(by.west!.openings).toEqual([{ kind: 'window', a: 23, b: 24 }])
  })

  it('builds walls around openings: below and above a window, above a door', () => {
    const runs = planWalls(box, [{ x: 13, z: 25 }], [{ x: 12, z: 20 }], 0.3)
    const north = runs.find((r) => r.side === 'north')!
    const pieces = wallPieces(north, 4, { top: 2.3 }, { sill: 1, top: 2.6 })
    expect(pieces).toEqual([
      { a: north.from, b: 12, y0: 0, y1: 4 },
      { a: 12, b: 13, y0: 0, y1: 1 },
      { a: 12, b: 13, y0: 2.6, y1: 4 },
      { a: 13, b: north.to, y0: 0, y1: 4 },
    ])
    const south = runs.find((r) => r.side === 'south')!
    expect(wallPieces(south, 4, { top: 2.3 }, { sill: 1, top: 2.6 })).toContainEqual({ a: 13, b: 14, y0: 2.3, y1: 4 })
    // a low wall: nothing above the door
    expect(wallPieces(south, 0.5, { top: 0.5 }, { sill: 0.5, top: 0.5 }).filter((p) => p.a === 13)).toEqual([])
  })

  it('knows which walls stand between the room and the camera', () => {
    const runs = planWalls(box, [], [], 0.3)
    const near = (yaw: number) =>
      runs
        .filter((r) => facesCamera(r, yaw))
        .map((r) => r.side)
        .sort()
    expect(near(45)).toEqual(['east', 'south'])
    expect(near(225)).toEqual(['north', 'west'])
  })

  it('darkens the floor towards the walls, most in the corners', () => {
    expect(floorShade(box, 11, 21, 1.5)).toBe(1)
    expect(floorShade(box, 14, 23, 1.5)).toBe(0)
    expect(floorShade(box, 11.75, 23, 1.5)).toBeCloseTo(0.5)
  })

  it('blends along the day, round midnight too', () => {
    const keys = [{ h: 6 }, { h: 12 }, { h: 20 }]
    expect(dayBlend(keys, 9)).toEqual({ i: 0, j: 1, k: 0.5 })
    const night = dayBlend(keys, 1)
    expect([night.i, night.j]).toEqual([2, 0])
    expect(night.k).toBeCloseTo(0.5)
  })
})
