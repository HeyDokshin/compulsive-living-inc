import { describe, expect, it } from 'vitest'
import { meshChunkRound, type RoundInput } from '../src/engine/world/mesher/roundMesher'

const GRASS = 1
const WATER = 2
const table = {
  kind: new Uint8Array([0, 1, 2]),
  tiles: new Float32Array(72),
  liquid: new Uint8Array([0, 0, 1]),
  topColor: new Float32Array([0, 0, 0, 0.4, 0.8, 0.3, 0.5, 0.8, 0.9]),
  sideColor: new Float32Array([0, 0, 0, 0.7, 0.5, 0.3, 0.5, 0.8, 0.9]),
  detailTop: new Int16Array([-1, 0, -1]),
  detailSide: new Int16Array([-1, 1, -1]),
}
const round = { subdiv: 3, smoothAcross: 6, smoothUp: 0, keep: 0.62, ao: 0.4 }
const H = 12
const PAD = 3

/** A chunk of a world given by a block function over world coordinates. */
function chunk(cx: number, block: (x: number, y: number, z: number) => number): RoundInput {
  const PX = 16 + PAD * 2
  const vol = new Uint16Array(PX * PX * (H + 2))
  for (let y = 0; y < H; y++)
    for (let z = -PAD; z < 16 + PAD; z++)
      for (let x = -PAD; x < 16 + PAD; x++) vol[x + PAD + (z + PAD) * PX + (y + 1) * PX * PX] = block(cx * 16 + x, y, z)
  return { vol, sx: 16, sy: H, sz: 16, pad: PAD, table, round }
}

// ground up to y 4 (stands at 5), a 6×6 plateau one higher across the chunk border at x 16, a single block
const land = (x: number, y: number, z: number) => {
  if (y <= 4) return GRASS
  if (y === 5 && x >= 13 && x < 19 && z >= 5 && z < 11) return GRASS
  if (y === 5 && x === 4 && z === 12) return GRASS
  return 0
}

describe('rounded island', () => {
  const a = meshChunkRound(chunk(0, land)).opaque
  const b = meshChunkRound(chunk(1, land)).opaque

  it('keeps plateaus flat on top and rounds their outline', () => {
    const tops: number[] = []
    for (let i = 0; i < a.position.length; i += 3) {
      const x = a.position[i]!
      const z = a.position[i + 2]!
      if (x > 14 && x < 15.5 && z > 7 && z < 9) tops.push(a.position[i + 1]!)
    }
    expect(tops.length).toBeGreaterThan(0)
    expect(Math.max(...tops)).toBeCloseTo(6, 0)
    // the plateau's corner at (13, 5) is cut round: nothing stands at full height right there
    let corner = 0
    for (let i = 0; i < a.position.length; i += 3)
      if (Math.hypot(a.position[i]! - 13, a.position[i + 2]! - 5) < 0.25 && a.position[i + 1]! > 5.8) corner++
    expect(corner).toBe(0)
  })

  it('keeps a single block', () => {
    let high = 0
    for (let i = 0; i < a.position.length; i += 3)
      if (Math.abs(a.position[i]! - 4.5) < 0.6 && Math.abs(a.position[i + 2]! - 12.5) < 0.6 && a.position[i + 1]! > 5.4) high++
    expect(high).toBeGreaterThan(0)
  })

  it('meets the next chunk without a seam', () => {
    // vertices on the shared border of A (x ≈ 16) are vertices of B (x ≈ 0) too
    const key = (x: number, y: number, z: number) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`
    const inB = new Set<string>()
    for (let i = 0; i < b.position.length; i += 3) inB.add(key(b.position[i]! + 16, b.position[i + 1]!, b.position[i + 2]!))
    let shared = 0
    let border = 0
    for (let t = 0; t < a.index.length; t++) {
      const v = a.index[t]!
      const x = a.position[v * 3]!
      if (x < 15.9) continue
      border++
      if (inB.has(key(x, a.position[v * 3 + 1]!, a.position[v * 3 + 2]!))) shared++
    }
    expect(border).toBeGreaterThan(0)
    expect(shared).toBe(border)
  })

  it('colors tops and sides, and tags detail slots', () => {
    let top = 0
    let side = 0
    for (let v = 0; v < a.color.length / 3; v++) {
      if (a.normal[v * 3 + 1]! > 0.95) {
        top++
        expect(a.detail![v]).toBe(0)
        expect(a.color[v * 3 + 1]).toBeGreaterThan(a.color[v * 3]!) // green
      } else if (a.normal[v * 3 + 1]! < 0.5) {
        expect(a.detail![v]).toBe(1)
      }
    }
    // walls stand up: many triangles face sideways
    for (let t = 0; t < a.index.length; t += 3) {
      const p = [0, 1, 2].map((j) => a.index[t + j]! * 3)
      const u = [0, 1, 2].map((c) => a.position[p[1]! + c]! - a.position[p[0]! + c]!)
      const w = [0, 1, 2].map((c) => a.position[p[2]! + c]! - a.position[p[0]! + c]!)
      const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!]
      if (Math.abs(n[1]!) / (Math.hypot(n[0]!, n[1]!, n[2]!) || 1) < 0.3) side++
    }
    expect(top).toBeGreaterThan(100)
    expect(side).toBeGreaterThan(10)
  })

  it('draws water where it meets air, not inside the bed', () => {
    const pond = (x: number, y: number, z: number) => (y <= 3 ? GRASS : y === 4 && (x < 6 || x > 10 || z < 6 || z > 10) ? GRASS : y === 4 ? WATER : 0)
    const out = meshChunkRound(chunk(0, pond))
    const w = out.transparent
    expect(w.index.length).toBeGreaterThan(0)
    for (let v = 0; v < w.position.length / 3; v++) {
      // the water surface: lowered a little under the brim, never down at the bed
      expect(w.position[v * 3 + 1]).toBeGreaterThan(4.5)
    }
  })
})
