import { describe, expect, it, vi } from 'vitest'
import { ConfigService } from '../src/engine/config/ConfigService'
import { EngineConfigSchema, WorldConfigSchema } from '../src/engine/engineConfig'
import { QUALITY_PRESETS } from '../src/engine/session/settings'
import { WorldService } from '../src/engine/world/WorldService'
import { Registry } from '../src/engine/registry/Registry'
import { EventBus } from '../src/engine/events/EventBus'
import { Hooks } from '../src/engine/events/Hooks'
import type { BlockDef, GameEvents, GameHooks } from '../src/engine/types'
import type { WorldGenStep } from '../src/engine/world/WorldGen'

describe('quality presets', () => {
  it('only set paths that exist in the engine config, with valid values', () => {
    for (const [name, preset] of Object.entries(QUALITY_PRESETS)) {
      const c = new ConfigService()
      const v = c.define('engine', EngineConfigSchema, 'engine')
      for (const [path, value] of Object.entries(preset)) {
        expect(() => c.set('engine', path, value), `${name}: ${path}`).not.toThrow()
        const got = path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], v)
        expect(got, `${name}: ${path}`).toBe(value)
      }
    }
  })
})

describe('WorldService', () => {
  it('keeps generating after a failed generation (the queue must not stay rejected)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cfg = WorldConfigSchema.parse({ chunksX: 1, chunksZ: 1, height: 8 })
    const steps = new Registry<WorldGenStep>('worldgen')
    steps.register({ id: 't:a', order: 1, run: () => undefined }, 'x')
    const ws = new WorldService(cfg, new Registry<BlockDef>('blocks'), steps, new EventBus<GameEvents>(), new Hooks<GameHooks>())
    // Make one generation crash outside the (already isolated) steps.
    const all = steps.all.bind(steps)
    let broken = true
    steps.all = () => {
      if (broken) {
        broken = false
        throw new Error('broken')
      }
      return all()
    }
    await expect(ws.regenerate()).rejects.toThrow('broken')
    await expect(ws.regenerate()).resolves.toBeUndefined()
  })
})
