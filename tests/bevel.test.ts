import { describe, expect, it } from 'vitest'
import { buildBevelGeometry, shadeParts, splitBoxes } from '../src/engine/models/bevelMesh'
import { flatAxis, flatPicture } from '../src/engine/models/thingMesh'
import { parseLayers } from '../src/engine/models/voxelModel'

// a little bench: two legs (q) under a seat of light and dark planks (p, P)
const bench = parseLayers(
  [
    ['q..q', 'q..q'],
    ['pppp', 'PPPP'],
  ],
  { p: '#c99560', P: '#b58450', q: '#6e4630' },
)

describe('bevelled boxes', () => {
  it('splits a model into boxes per color, or per part', () => {
    expect(splitBoxes(bench)).toHaveLength(4) // two legs, two planks
    const parts = shadeParts(bench.colors, 70)
    expect(parts).toEqual([0, 1, 1, 3]) // P joins p; the dark legs stay apart
    const boxes = splitBoxes(bench, (c) => parts[c]!)
    expect(boxes).toHaveLength(3) // the seat is one box now
    const seat = boxes.find((b) => b.min[1] === 1)!
    expect(seat).toMatchObject({ min: [0, 1, 0], max: [4, 2, 2] })
  })

  it('covers every voxel once', () => {
    const boxes = splitBoxes(bench)
    const volume = boxes.reduce((s, b) => s + (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]), 0)
    expect(volume).toBe(bench.voxels.filter((v) => v).length)
  })

  it('keeps different materials apart even when the colors are close', () => {
    expect(shadeParts(['#000000', '#808080', '#828282'], 70, () => false)).toEqual([0, 1, 2])
  })

  it('bevels each box: 44 triangles, inside its bounds, normals pointing out', () => {
    const g = buildBevelGeometry([{ min: [0, 0, 0], max: [4, 2, 6], color: 1 }], [0, 0, 0], 0.4)
    expect(g.index).toHaveLength(44 * 3)
    for (let i = 0; i < g.position.length; i += 3) {
      expect(g.position[i]).toBeGreaterThanOrEqual(0)
      expect(g.position[i]).toBeLessThanOrEqual(4)
      expect(g.position[i + 1]).toBeLessThanOrEqual(2)
      expect(g.position[i + 2]).toBeLessThanOrEqual(6)
    }
    // every triangle winds so that it faces along its normal (outwards)
    for (let t = 0; t < g.index.length; t += 3) {
      const [a, b, c] = [g.index[t]!, g.index[t + 1]!, g.index[t + 2]!].map((k) => [g.position[k * 3]!, g.position[k * 3 + 1]!, g.position[k * 3 + 2]!])
      const e1 = b!.map((v, k) => v - a![k]!)
      const e2 = c!.map((v, k) => v - a![k]!)
      const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!]
      const center = [2, 1, 3]
      const out = a!.map((v, k) => v - center[k]!)
      expect(n[0]! * out[0]! + n[1]! * out[1]! + n[2]! * out[2]!).toBeGreaterThanOrEqual(0)
    }
  })

  it('never bevels more than a third of a thin side', () => {
    const g = buildBevelGeometry([{ min: [0, 0, 0], max: [1, 0.3, 1], color: 1 }], [0, 0, 0], 2)
    const ys = new Set(g.position.filter((_, i) => i % 3 === 1).map((v) => +v.toFixed(3)))
    expect([...ys].sort()).toEqual([0, 0.1, 0.2, 0.3])
  })
})

describe('flat things', () => {
  const rug = parseLayers([['.aa.', 'abba', 'abba', '.aa.']], { a: '#ff0000', b: '#0000ff' })
  it('knows a rug lies flat and a picture hangs', () => {
    expect(flatAxis(rug, 4)).toBe('y')
    expect(flatAxis(parseLayers([['aaaa'], ['aaaa'], ['aaaa'], ['aaaa']], { a: '#ffffff' }), 4)).toBe('z')
    expect(flatAxis(bench)).toBeNull()
  })
  it('paints its picture from above, see-through where empty but with the color next to it', () => {
    const pic = flatPicture(rug, 'y', rug.colors)
    expect([pic.w, pic.h]).toEqual([4, 4])
    const at = (x: number, y: number) => [...pic.rgba.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4)]
    expect(at(1, 1)).toEqual([0, 0, 255, 255])
    expect(at(1, 0)).toEqual([255, 0, 0, 255])
    const corner = at(0, 0)
    expect(corner[3]).toBe(0) // empty…
    expect(corner[0]).toBe(255) // …but red, like its neighbours: no dark fringe when scaled
    expect(pic.main).toBe(1) // red covers most
  })
})
