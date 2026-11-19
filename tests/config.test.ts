import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ConfigService } from '../src/engine/config/ConfigService'
import { describeSchema } from '../src/engine/config/schemaInfo'
import { EngineConfigSchema } from '../src/engine/engineConfig'

const Schema = z.object({
  speed: z.number().min(0).max(10).default(2).meta({ step: 0.5 }),
  nested: z.object({ on: z.boolean().default(true), color: z.string().default('#fff').meta({ color: true }) }).prefault({}),
})

describe('ConfigService', () => {
  it('merges defaults < file < live edits and keeps object identity', () => {
    const c = new ConfigService()
    c.setFileData('p', { speed: 5 })
    const v = c.define('p', Schema, 'p')
    const nested = v.nested
    expect(v).toEqual({ speed: 5, nested: { on: true, color: '#fff' } })
    c.set('p', 'nested.on', false)
    expect(v.nested.on).toBe(false)
    expect(v.nested).toBe(nested)
    expect(() => c.set('p', 'speed', 99)).toThrow()
    c.setFileData('p', { speed: 7 })
    expect(v.speed).toBe(7)
    c.resetToDefaults('p')
    expect(v.speed).toBe(2)
  })

  it('keeps live values when a plugin re-defines its config (hot reload)', () => {
    const c = new ConfigService()
    const v = c.define('p', Schema, 'p')
    c.set('p', 'speed', 9)
    const v2 = c.define('p', Schema, 'p')
    expect(v2).toBe(v)
    expect(v2.speed).toBe(9)
  })

  it('falls back to defaults on an invalid file', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const c = new ConfigService()
    c.setFileData('p', { speed: 'fast' })
    expect(c.define('p', Schema, 'p').speed).toBe(2)
  })
})

describe('describeSchema', () => {
  it('extracts ranges, steps, colors and nesting for the debug panel', () => {
    const info = describeSchema(Schema)
    expect(info.kind).toBe('object')
    if (info.kind !== 'object') return
    expect(info.fields.speed).toMatchObject({ kind: 'number', min: 0, max: 10, meta: { step: 0.5 } })
    const nested = info.fields.nested!
    expect(nested.kind).toBe('object')
    if (nested.kind === 'object') expect(nested.fields.color).toMatchObject({ kind: 'string', meta: { color: true } })
  })

  it('engine config parses from an empty object', () => {
    expect(EngineConfigSchema.parse({}).camera.zoom).toBe(1)
  })
})
