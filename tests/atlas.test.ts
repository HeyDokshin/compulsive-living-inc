import { describe, expect, it } from 'vitest'
import { buildBlockTable, faceTextures, planAtlas, tileRect } from '../src/engine/render/BlockAtlas'
import { BlockPalette } from '../src/engine/world/BlockPalette'
import { KIND_OPAQUE, KIND_TRANSPARENT } from '../src/engine/world/mesher/mesher'
import type { BlockDef } from '../src/engine/types'

const grass = { id: 'core:grass', color: '#0f0', solid: true, transparent: false, textures: { top: 't:top', side: 't:side', bottom: 't:dirt' } } as BlockDef
const water = { id: 'core:water', color: '#00f', solid: false, transparent: true } as BlockDef

describe('atlas', () => {
  it('resolves per-face textures with fallbacks', () => {
    expect(faceTextures(grass)).toEqual(['t:side', 't:side', 't:top', 't:dirt', 't:side', 't:side'])
    expect(faceTextures(water)).toEqual(Array(6).fill('auto:core:water'))
  })

  it('plans unique tiles with "missing" first and power-of-two size', () => {
    const plan = planAtlas([grass, water])
    expect(plan.tiles).toEqual(['missing', 't:side', 't:top', 't:dirt', 'auto:core:water'])
    expect(plan.size).toBe(64)
    const [u, v, w, h] = tileRect(plan, 1)
    expect([u, v, w, h]).toEqual([0.25, 0.75, 0.25, 0.25])
  })

  it('builds the mesher table for every palette number', () => {
    const palette = new BlockPalette()
    palette.num('mod:removed') // known number, no definition any more
    const plan = planAtlas([grass, water])
    const t = buildBlockTable(plan, [grass, water], palette)
    const g = palette.num('core:grass')
    expect(t.kind[g]).toBe(KIND_OPAQUE)
    expect(t.kind[palette.num('core:water')]).toBe(KIND_TRANSPARENT)
    // top face of grass uses t:top (tile 2)
    expect([...t.tiles.slice((g * 6 + 2) * 4, (g * 6 + 2) * 4 + 4)]).toEqual(tileRect(plan, 2))
    // removed block → missing texture
    const r = palette.num('mod:removed')
    expect([...t.tiles.slice(r * 24, r * 24 + 4)]).toEqual(tileRect(plan, 0))
  })
})
