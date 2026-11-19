import { describe, expect, it } from 'vitest'
import { VoxelWorld } from '../src/engine/world/VoxelWorld'
import { KIND_OPAQUE, KIND_TRANSPARENT, meshChunk, tintAt, valueNoise, type BlockTable } from '../src/engine/world/mesher/mesher'

function table(kinds: number[]): BlockTable {
  return {
    kind: new Uint8Array(kinds),
    tiles: new Float32Array(kinds.length * 24).fill(0.5),
    liquid: new Uint8Array(kinds.map((k) => (k === KIND_TRANSPARENT ? 1 : 0))),
  }
}

function mesh(setup: (w: VoxelWorld) => void, kinds = [0, KIND_OPAQUE, KIND_TRANSPARENT]) {
  const w = new VoxelWorld()
  w.palette.num('t:stone')
  w.palette.num('t:water')
  w.reset(1, 1, 8)
  setup(w)
  return meshChunk({ vol: w.paddedVolume(0), sx: 16, sy: 8, sz: 16, table: table(kinds), aoCurve: [0.4, 0.6, 0.8, 1] })
}

const quads = (b: { index: Uint32Array }) => b.index.length / 6

describe('greedy mesher', () => {
  it('a single block has 6 faces, fully lit', () => {
    const out = mesh((w) => w.set(4, 3, 4, 1))
    expect(quads(out.opaque)).toBe(6)
    expect([...out.opaque.color].every((c) => c === 1)).toBe(true)
  })

  it('merges a flat 16×16 floor into one quad, hiding world-edge walls and the underside', () => {
    const out = mesh((w) => {
      for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) w.set(x, 0, z, 1)
    })
    // Beyond the world edge the edge column repeats, so only the top remains.
    expect(quads(out.opaque)).toBe(1)
  })

  it('hides faces between blocks and darkens corners (AO)', () => {
    const out = mesh((w) => {
      w.set(4, 1, 4, 1)
      w.set(5, 1, 4, 1)
      w.set(4, 2, 5, 1) // overhang next to the top of (4,1,4)
    })
    // two blocks side by side: shared faces removed
    expect(quads(out.opaque)).toBeLessThan(18)
    expect(Math.min(...out.opaque.color)).toBeLessThan(1)
  })

  it('puts water in the transparent mesh, lowers its surface, keeps the ground under it', () => {
    const out = mesh((w) => {
      w.set(4, 0, 4, 1)
      w.set(4, 1, 4, 2)
      w.set(8, 1, 8, 2) // a 2-high water column: only the top cell is lowered
      w.set(8, 2, 8, 2)
    })
    const ys = [...out.transparent.position].filter((_, i) => i % 3 === 1)
    expect(Math.max(...ys)).toBeCloseTo(3 - 0.125)
    expect(ys).toContain(2 - 0.125 + 0.125) // side faces of the lower cell keep full height (y = 2)
    expect(quads(out.opaque)).toBe(5) // ground top is visible through water, bottom never drawn
  })

  it('never lowers opaque faces whose AO happens to pack to the liquid flag', () => {
    // A ground block with a single occluder at one top corner: AO = [2,3,3,3] packs to 0xfe.
    const out = mesh((w) => {
      for (let x = 2; x < 8; x++) for (let z = 2; z < 8; z++) w.set(x, 0, z, 1)
      w.set(3, 1, 3, 1)
    })
    const ys = [...out.opaque.position].filter((_, i) => i % 3 === 1)
    expect(ys.every((y) => Number.isInteger(y))).toBe(true)
  })

  it('can limit merging so every vertex stays on the block grid', () => {
    const w = new VoxelWorld()
    w.reset(1, 1, 4)
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) w.set(x, 0, z, 1)
    const t = table([0, KIND_OPAQUE])
    const out = meshChunk({ vol: w.paddedVolume(0), sx: 16, sy: 4, sz: 16, table: t, aoCurve: [1, 1, 1, 1], maxMerge: 1 })
    expect(quads(out.opaque)).toBe(256)
  })

  it('treats block numbers missing from the table as opaque', () => {
    const out = mesh((w) => w.set(1, 1, 1, 7))
    expect(quads(out.opaque)).toBe(6)
  })

  it('tints only top faces of tintable blocks, seamlessly in world space', () => {
    const w = new VoxelWorld()
    w.reset(1, 1, 4)
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) w.set(x, 0, z, 1)
    const t = table([0, KIND_OPAQUE])
    t.tint = new Uint8Array([0, 1])
    const tint = { origin: [32, 48] as [number, number], seed: 7, scale: 0.2, strength: 1, a: [1, 1, 0.5] as [number, number, number], b: [0.6, 0.9, 0.7] as [number, number, number] }
    const out = meshChunk({ vol: w.paddedVolume(0), sx: 16, sy: 4, sz: 16, table: t, aoCurve: [1, 1, 1, 1], maxMerge: 1, tint })
    const blues = [...out.opaque.color].filter((_, i) => i % 3 === 2)
    expect(new Set(blues.map((v) => v.toFixed(3))).size).toBeGreaterThan(10) // varied
    // a vertex at world (40, 50) gets exactly tintAt(40, 50)
    const pos = out.opaque.position
    for (let v = 0; v < pos.length / 3; v++) {
      if (pos[v * 3] === 8 && pos[v * 3 + 2] === 2) {
        expect(out.opaque.color[v * 3 + 2]).toBeCloseTo(tintAt(tint, 40, 50)[2])
      }
    }
  })

  it('value noise is smooth and in [0, 1]', () => {
    let prev = valueNoise(0, 0.5, 3)
    for (let i = 1; i < 200; i++) {
      const v = valueNoise(i * 0.01, 0.5, 3)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
      expect(Math.abs(v - prev)).toBeLessThan(0.05)
      prev = v
    }
  })
})
