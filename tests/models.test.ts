import { describe, expect, it } from 'vitest'
import JSON5 from 'json5'
import { readFileSync } from 'node:fs'
import { buildVoxelGeometry, parseLayers, parseVox, voxelAt } from '../src/engine/models/voxelModel'
import { ModelDefSchema, RigDefSchema } from '../src/engine/models/defs'

describe('voxel models', () => {
  it('parses text layers (bottom→top, back→front, left→right)', () => {
    const m = parseLayers([['ab', '..'], ['.a', 'a.']], { a: '#ff0000', b: '#00ff00' })
    expect(m.size).toEqual([2, 2, 2])
    expect(voxelAt(m, 0, 0, 0)).toBe(1)
    expect(voxelAt(m, 1, 0, 0)).toBe(2)
    expect(voxelAt(m, 0, 1, 1)).toBe(1)
    expect(voxelAt(m, 1, 1, 1)).toBe(0)
    expect(() => parseLayers([['x']], {})).toThrow(/unknown palette character/)
  })

  it('builds only exposed faces', () => {
    const one = parseLayers([['a']], { a: '#fff' })
    expect(buildVoxelGeometry(one, [0, 0, 0]).index.length / 6).toBe(6)
    const two = parseLayers([['ab']], { a: '#fff', b: '#000' })
    expect(buildVoxelGeometry(two, [0, 0, 0]).index.length / 6).toBe(10)
  })

  it('merges faces of one color, up to a limit, without losing area or flipping any', () => {
    const bar = parseLayers([['aaaa']], { a: '#fff' })
    expect(buildVoxelGeometry(bar, [0, 0, 0]).index.length / 6).toBe(6)
    expect(buildVoxelGeometry(bar, [0, 0, 0], 2).index.length / 6).toBe(10)
    // an L with a hole, two colors: total area must equal the exposed voxel faces, normals must agree with winding
    const m = parseLayers([['aab', 'a.b', 'aaa'], ['a..', 'a..', 'bbb']], { a: '#fff', b: '#000' })
    let faces = 0
    for (let x = 0; x < 3; x++)
      for (let y = 0; y < 2; y++)
        for (let z = 0; z < 3; z++)
          if (voxelAt(m, x, y, z)) for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) if (!voxelAt(m, x + dx, y + dy, z + dz)) faces++
    const g = buildVoxelGeometry(m, [1.5, 0, 1.5])
    const at = (i: number) => g.position.slice(i * 3, i * 3 + 3)
    let area = 0
    for (let i = 0; i < g.index.length; i += 3) {
      const [a, b, c] = [at(g.index[i]!), at(g.index[i + 1]!), at(g.index[i + 2]!)]
      const u = b.map((v, k) => v - a[k]!)
      const v = c.map((w, k) => w - a[k]!)
      const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!]
      area += Math.hypot(...n) / 2
      const normal = g.normal.slice(g.index[i]! * 3, g.index[i]! * 3 + 3)
      expect(n[0]! * normal[0]! + n[1]! * normal[1]! + n[2]! * normal[2]!).toBeGreaterThan(0)
    }
    expect(area).toBeCloseTo(faces)
  })

  it('parses a MagicaVoxel .vox file', () => {
    // Hand-built file: SIZE 2×1×3, two voxels, no palette.
    const chunk = (id: string, content: number[]) => [...[...id].map((c) => c.charCodeAt(0)), ...u32(content.length), ...u32(0), ...content]
    const u32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255]
    const size = chunk('SIZE', [...u32(2), ...u32(1), ...u32(3)])
    const xyzi = chunk('XYZI', [...u32(2), 0, 0, 0, 5, 1, 0, 2, 7])
    const main = [...'MAIN'].map((c) => c.charCodeAt(0)).concat(u32(0), u32(size.length + xyzi.length))
    const bytes = new Uint8Array([...[...'VOX '].map((c) => c.charCodeAt(0)), ...u32(150), ...main, ...size, ...xyzi])
    const m = parseVox(bytes.buffer)
    expect(m.size).toEqual([2, 3, 1]) // z-up → y-up
    expect(voxelAt(m, 0, 0, 0)).toBe(5)
    expect(voxelAt(m, 1, 2, 0)).toBe(7)
  })

  it('core character content is valid', () => {
    const models = JSON5.parse(readFileSync('content/core/models.json5', 'utf8')) as unknown[]
    const parsed = models.map((m) => ModelDefSchema.parse(m))
    for (const m of parsed) expect(() => parseLayers(m.layers!, m.palette)).not.toThrow()
    const rigs = (JSON5.parse(readFileSync('content/core/rigs.json5', 'utf8')) as unknown[]).map((r) => RigDefSchema.parse(r))
    const ids = new Set(parsed.map((m) => m.id))
    for (const part of rigs[0]!.parts) expect(ids.has(part.model)).toBe(true)
  })
})
