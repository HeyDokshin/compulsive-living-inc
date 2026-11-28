import { describe, expect, it } from 'vitest'
import { buildSmoothGeometry } from '../src/engine/models/smoothMesh'
import { parseLayers } from '../src/engine/models/voxelModel'

const cube = parseLayers(
  Array.from({ length: 4 }, () => ['aaaa', 'aaaa', 'aaaa', 'aaab']),
  { a: '#ff0000', b: '#00ff00' },
)
const opts = { subdiv: 3, smooth: 2, iso: 0.42 }

describe('smooth meshes for round characters', () => {
  const g = buildSmoothGeometry(cube, [2, 0, 2], opts)

  it('is a closed surface: every edge joins two triangles', () => {
    const edges = new Map<string, number>()
    for (let t = 0; t < g.index.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = g.index[t + e]!
        const b = g.index[t + ((e + 1) % 3)]!
        const key = a < b ? `${a},${b}` : `${b},${a}`
        edges.set(key, (edges.get(key) ?? 0) + 1)
      }
    }
    expect(g.index.length).toBeGreaterThan(100)
    for (const n of edges.values()) expect(n).toBe(2)
  })

  it('faces outwards, keeps the size and rounds the corners', () => {
    const c = [0, 2, 0]
    for (let t = 0; t < g.index.length; t += 3) {
      const [a, b, d] = [g.index[t]!, g.index[t + 1]!, g.index[t + 2]!].map((i) => [g.position[i * 3]!, g.position[i * 3 + 1]!, g.position[i * 3 + 2]!])
      const u = [b![0]! - a![0]!, b![1]! - a![1]!, b![2]! - a![2]!]
      const w = [d![0]! - a![0]!, d![1]! - a![1]!, d![2]! - a![2]!]
      const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!]
      const out = [a![0]! - c[0]!, a![1]! - c[1]!, a![2]! - c[2]!]
      expect(n[0]! * out[0]! + n[1]! * out[1]! + n[2]! * out[2]!).toBeGreaterThanOrEqual(-1e-6)
    }
    for (let i = 0; i < 3; i++) expect(g.max[i]! - g.min[i]!).toBeGreaterThan(3.4)
    // a corner of the 4³ box is cut off: no vertex near (2, 4, 2)
    let near = Infinity
    for (let i = 0; i < g.position.length; i += 3) near = Math.min(near, Math.hypot(g.position[i]! - 2, g.position[i + 1]! - 4, g.position[i + 2]! - 2))
    expect(near).toBeGreaterThan(0.3)
  })

  it('keeps the painted colors', () => {
    expect(new Set(g.colorIndex)).toEqual(new Set([1, 2]))
  })

  it('keeps thin parts such as ears', () => {
    const ear = parseLayers(
      [
        ['aaa', 'aaa', 'aaa'],
        ['.a.', '...', '...'],
        ['.a.', '...', '...'],
        ['.a.', '...', '...'],
      ],
      { a: '#fff' },
    )
    const e = buildSmoothGeometry(ear, [0, 0, 0], opts)
    expect(e.max[1]).toBeGreaterThan(3)
  })
})
