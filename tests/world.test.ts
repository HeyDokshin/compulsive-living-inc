import { describe, expect, it } from 'vitest'
import { VoxelWorld } from '../src/engine/world/VoxelWorld'
import { AIR, BlockPalette } from '../src/engine/world/BlockPalette'

describe('BlockPalette', () => {
  it('assigns stable numbers with air = 0', () => {
    const p = new BlockPalette()
    expect(p.num(AIR)).toBe(0)
    const a = p.num('core:grass')
    p.num('core:sand')
    expect(p.num('core:grass')).toBe(a)
    const q = new BlockPalette()
    q.load(p.entries())
    expect(q.num('core:sand')).toBe(p.num('core:sand'))
  })
})

describe('VoxelWorld', () => {
  it('gets/sets across chunks and reports the surface', () => {
    const w = new VoxelWorld()
    w.reset(2, 2, 16)
    expect(w.sizeX).toBe(32)
    w.setId(17, 5, 20, 'core:stone')
    expect(w.getId(17, 5, 20)).toBe('core:stone')
    expect(w.get(-1, 0, 0)).toBe(0)
    expect(w.surfaceY(17, 20)).toBe(6)
    expect(w.surfaceY(0, 0)).toBe(0)
  })

  it('marks neighbour chunks dirty for edge blocks only', () => {
    const w = new VoxelWorld()
    w.reset(2, 2, 8)
    w.dirty.clear()
    w.setId(5, 1, 5, 'x:y')
    expect([...w.dirty]).toEqual([0])
    w.dirty.clear()
    w.setId(15, 1, 15, 'x:y')
    expect([...w.dirty].sort()).toEqual([0, 1, 2, 3])
  })

  it('builds a padded volume including neighbour borders', () => {
    const w = new VoxelWorld()
    w.reset(2, 1, 4)
    const n = w.palette.num('x:y')
    w.set(16, 2, 3, n) // first column of chunk 1
    const vol = w.paddedVolume(0)
    const P = 18
    expect(vol[16 + 1 + (3 + 1) * P + (2 + 1) * P * P]).toBe(n)
  })
})
