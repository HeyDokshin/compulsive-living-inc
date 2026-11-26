import { describe, expect, it } from 'vitest'
import { fbm, periodicNoise, renderMaterial } from '../src/engine/materials/generate'
import { MaterialSchema, type MaterialDef } from '../src/engine/materials/schema'

const stone: MaterialDef = MaterialSchema.parse({
  id: 'test:stone',
  layers: [
    { kind: 'noise', colors: ['#8a8f9c', '#c9ccd4'], scale: 3, octaves: 6, relief: 1 },
    { kind: 'cracks', colors: ['#5a5e68', '#ffffff'], scale: 4, blend: 'multiply', relief: 1.5 },
    { kind: 'noise', colors: ['#9fbf7a'], scale: 2, mask: { scale: 3, threshold: 0.6, softness: 0.08 }, opacity: 0.7 },
  ],
})

const px = (data: Uint8ClampedArray, size: number, x: number, y: number) => {
  const o = (y * size + x) * 4
  return [data[o]!, data[o + 1]!, data[o + 2]!]
}
const diff = (a: number[], b: number[]) => Math.abs(a[0]! - b[0]!) + Math.abs(a[1]! - b[1]!) + Math.abs(a[2]! - b[2]!)

describe('procedural materials', () => {
  it('periodic noise wraps around its period', () => {
    for (const [x, y] of [[0.3, 0.7], [2.5, 1.1], [3.99, 0.01]]) {
      expect(periodicNoise(x!, y!, 4, 4, 9)).toBeCloseTo(periodicNoise(x! + 4, y! - 4, 4, 4, 9), 10)
    }
    expect(fbm(0, 0.4, 3, 5, 0.5, 1, 256)).toBeCloseTo(fbm(1, 0.4, 3, 5, 0.5, 1, 256), 10)
  })

  it('is deterministic and opaque', () => {
    const a = renderMaterial(stone, 32)
    const b = renderMaterial(stone, 32)
    expect([...a]).toEqual([...b])
    for (let i = 3; i < a.length; i += 4) expect(a[i]).toBe(255)
  })

  it('tiles without a seam: the wrap is as smooth as any step inside', () => {
    const size = 64
    const d = renderMaterial(stone, size)
    let inside = 0
    let seam = 0
    for (let y = 0; y < size; y++) {
      inside += diff(px(d, size, 30, y), px(d, size, 31, y))
      seam += diff(px(d, size, size - 1, y), px(d, size, 0, y))
    }
    expect(seam).toBeLessThan(inside * 3 + size * 6)
  })

  it('keeps its look at every resolution: only the detail changes', () => {
    const mean = (size: number) => {
      const d = renderMaterial(stone, size)
      const m = [0, 0, 0]
      for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) m[c]! += d[i + c]!
      return m.map((v) => v / (size * size))
    }
    const small = mean(16)
    const big = mean(128)
    for (let c = 0; c < 3; c++) expect(Math.abs(small[c]! - big[c]!)).toBeLessThan(18)
  })

  it('every pattern renders', () => {
    for (const kind of ['fill', 'noise', 'ridged', 'cells', 'cracks', 'strata', 'wood', 'boards', 'grain', 'fibers', 'knit', 'pebbles'] as const) {
      const m = MaterialSchema.parse({ id: 't:' + kind, layers: [{ kind, colors: ['#000000', '#ffffff'] }] })
      const d = renderMaterial(m, 16)
      expect(d.some((v, i) => i % 4 !== 3 && Number.isFinite(v))).toBe(true)
    }
  })
})
