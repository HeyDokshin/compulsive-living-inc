import { describe, expect, it } from 'vitest'
import { VoxelWorld } from '../src/engine/world/VoxelWorld'
import { generateWorld, type WorldGenStep } from '../src/engine/world/WorldGen'
import { sampleLight, DEFAULT_LIGHT_KEYS } from '../src/engine/render/dayCycle'

const opts = { seed: 42, chunksX: 2, chunksZ: 2, height: 16 }

describe('generateWorld', () => {
  it('runs enabled steps by order, isolates failures, shares data', async () => {
    const calls: string[] = []
    const steps: WorldGenStep[] = [
      { id: 't:voxels', order: 400, run: (ctx) => void (calls.push('voxels'), ctx.world.fillColumn(0, 0, 0, ctx.data.h as number, ctx.block('t:stone'))) },
      { id: 't:shape', order: 100, run: (ctx) => void (calls.push('shape'), (ctx.data.h = 5)) },
      { id: 't:broken', order: 200, run: () => { throw new Error('boom') } },
      { id: 't:off', order: 300, enabled: false, run: () => void calls.push('off') },
    ]
    const w = new VoxelWorld()
    const report = await generateWorld(w, steps, opts)
    expect(calls).toEqual(['shape', 'voxels'])
    expect(report.steps.find((s) => s.id === 't:broken')?.error).toBe('boom')
    expect(w.surfaceY(0, 0)).toBe(5)
    expect(w.dirty.size).toBe(4)
  })

  it('is deterministic per seed and per salt', async () => {
    const sample = async (seed: number) => {
      let v: number[] = []
      await generateWorld(new VoxelWorld(), [{ id: 't:a', order: 1, run: (ctx) => void (v = [ctx.rng('a')(), ctx.noise('n')(1.5, 2.5)]) }], { ...opts, seed })
      return v
    }
    expect(await sample(1)).toEqual(await sample(1))
    expect(await sample(1)).not.toEqual(await sample(2))
  })
})

describe('day cycle', () => {
  it('is bright at noon, dark at midnight, and wraps', () => {
    const noon = sampleLight(DEFAULT_LIGHT_KEYS, 12, 35, 60)
    const night = sampleLight(DEFAULT_LIGHT_KEYS, 0, 35, 60)
    expect(noon.sunIntensity).toBeGreaterThan(2)
    expect(night.sunIntensity).toBeLessThan(0.5)
    expect(night.isNight).toBe(true)
    expect(noon.dir[1]).toBeGreaterThan(0.8)
    expect(sampleLight(DEFAULT_LIGHT_KEYS, 23.9, 35, 60).sunIntensity).toBeCloseTo(sampleLight(DEFAULT_LIGHT_KEYS, -0.1, 35, 60).sunIntensity)
  })
})
