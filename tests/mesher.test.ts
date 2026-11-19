import { describe, expect, it } from 'vitest'
import { VoxelWorld } from '../src/engine/world/VoxelWorld'
import { KIND_OPAQUE, KIND_TRANSPARENT, meshChunk, type BlockTable } from '../src/engine/world/mesher/mesher'

function table(kinds: number[]): BlockTable {
  return { kind: new Uint8Array(kinds), tiles: new Float32Array(kinds.length * 24).fill(0.5) }
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

  it('merges a flat 16×16 floor into one quad per side and skips the world underside', () => {
    const out = mesh((w) => {
      for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) w.set(x, 0, z, 1)
    })
    // top + 4 sides (edges of the chunk face air outside the world); no bottom at y=0
    expect(quads(out.opaque)).toBe(5)
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

  it('puts water in the transparent mesh and keeps the face of the ground under it', () => {
    const out = mesh((w) => {
      w.set(4, 0, 4, 1)
      w.set(4, 1, 4, 2)
    })
    expect(quads(out.transparent)).toBe(5) // no face against the ground below
    expect(quads(out.opaque)).toBe(5) // ground top is visible through water, bottom never drawn
  })

  it('treats block numbers missing from the table as opaque', () => {
    const out = mesh((w) => w.set(1, 1, 1, 7))
    expect(quads(out.opaque)).toBe(6)
  })
})
