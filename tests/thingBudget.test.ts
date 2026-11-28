import { readdirSync, readFileSync, existsSync } from 'node:fs'
import JSON5 from 'json5'
import { describe, expect, it } from 'vitest'
import { ModelDefSchema } from '../src/engine/models/defs'
import { buildThing, isSmall, type ModelBuild } from '../src/engine/models/thingMesh'
import { defaultPivot, parseLayers } from '../src/engine/models/voxelModel'

/** Triangles a thing may cost: small things are drawn many times over, big ones (stalls, houses) once. */
const BUDGET = (small: boolean) => (small ? 2000 : 16000)
const BUILD: ModelBuild = { style: 'auto', bevel: 0.45, maxBoxes: 36, merge: 70 }

const models = readdirSync('content')
  .map((pack) => `content/${pack}/models.json5`)
  .filter((f) => existsSync(f))
  .flatMap((f) => {
    const raw = JSON5.parse(readFileSync(f, 'utf8')) as unknown
    return (Array.isArray(raw) ? raw : (raw as { entries: unknown[] }).entries).map((d) => ModelDefSchema.parse(d))
  })
  .filter((d) => d.layers && !d.round && d.style !== 'blocks')

describe('things built from voxels', () => {
  it('finds the models', () => expect(models.length).toBeGreaterThan(50))

  it('stays within its triangle budget', () => {
    const over: string[] = []
    for (const d of models) {
      const m = parseLayers(d.layers!, d.palette)
      const g = buildThing(
        m,
        d.pivot ?? defaultPivot(m),
        { style: d.style === 'bevel' ? 'bevel' : 'auto', scale: d.scale, parts: d.parts, palette: d.palette },
        BUILD,
      )
      const tris = g.index.length / 3
      if (tris > BUDGET(isSmall(m, d.scale))) over.push(`${d.id}: ${tris}`)
    }
    expect(over).toEqual([])
  })
})
