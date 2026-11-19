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
    const two = parseLayers([['aa']], { a: '#fff' })
    expect(buildVoxelGeometry(two, [0, 0, 0]).index.length / 6).toBe(10)
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
