import { describe, expect, it, vi } from 'vitest'
import JSON5 from 'json5'
import { ID_PATTERN } from '../src/engine/registry/Registry'
import { ContentLoader } from '../src/engine/content/ContentLoader'
import { RegistryHub } from '../src/engine/registry/RegistryHub'
import { Entities } from '../src/engine/ecs/Entities'
import { EventBus } from '../src/engine/events/EventBus'
import { Hooks } from '../src/engine/events/Hooks'
import { PrefabSchema, type GameEvents, type GameHooks, type PrefabDef } from '../src/engine/types'
import type { z } from 'zod'

describe('ContentLoader + prefabs', () => {
  it('loads packs into registries (incl. plugin registries) and reloads cleanly', () => {
    const hub = new RegistryHub()
    hub.create('blocks', undefined, 'engine')
    hub.create('fishing:baits', undefined, 'fishing')
    const loader = new ContentLoader(hub)
    loader.setFiles({
      '/content/core/blocks.json5': `{ entries: [{ id: 'core:grass' }], tags: { 'core:ground': ['core:grass'] } }`,
      '/content/fishing/fishing.baits.json5': `[{ id: 'fishing:worm' }]`,
    })
    expect(loader.reloadAll().sort()).toEqual(['core', 'fishing'])
    expect(hub.get('blocks').isTagged('core:grass', '#core:ground')).toBe(true)
    expect(hub.get('fishing:baits').has('fishing:worm')).toBe(true)
    loader.setFiles({ '/content/core/blocks.json5': `[{ id: 'core:sand' }]` })
    loader.reloadAll()
    expect(hub.get('blocks').ids()).toEqual(['core:sand'])
  })

  it('spawns prefabs with inheritance, overrides, hooks and validation', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const hub = new RegistryHub()
    const prefabs = hub.create<PrefabDef>('prefabs', PrefabSchema as z.ZodType<PrefabDef>, 'engine')
    prefabs.register({ id: 't:base', components: { name: 'base', model: { color: '#111' } } } as PrefabDef, 'test')
    prefabs.register({ id: 't:child', extends: 't:base', components: { model: { size: [2, 2, 2] } } } as PrefabDef, 'test')
    const hooks = new Hooks<GameHooks>()
    hooks.tap('entity:beforeSpawn', (c) => ({ ...c, name: c.name + '!' }))
    const ents = new Entities(prefabs, new EventBus<GameEvents>(), hooks)
    const e = ents.spawn('t:child', { transform: { x: 1, y: 2, z: 3, rotY: 0 } })
    expect(e.name).toBe('base!')
    expect(e.model).toEqual({ shape: 'box', size: [2, 2, 2], color: '#111', anchor: 'bottom' })
    expect(e.prefab).toBe('t:child')
    expect(e.uid).toBe(1)
    expect(() => ents.spawn({ transform: { x: 'no' } as never })).toThrow(/transform/)
  })
})

describe('shipped content', () => {
  it('has only valid ids, and every model a rig asks for exists', () => {
    const files = import.meta.glob<string>(['../content/**/*.json5', '../mods/*/content/*.json5'], { query: '?raw', import: 'default', eager: true })
    const bad: string[] = []
    const ids = new Set<string>()
    const wanted: string[] = []
    for (const [path, text] of Object.entries(files)) {
      const data = JSON5.parse(text) as unknown
      const entries = (Array.isArray(data) ? data : ((data as { entries?: unknown[] }).entries ?? [])) as Array<{ id?: string; parts?: Array<{ model?: string }> }>
      for (const e of entries) {
        if (!e.id) continue
        if (!ID_PATTERN.test(e.id)) bad.push(`${path}: ${e.id}`)
        if (/\/models\.json5$/.test(path)) ids.add(e.id)
        if (/\/rigs\.json5$/.test(path)) for (const p of e.parts ?? []) if (p.model) wanted.push(p.model)
      }
    }
    expect(Object.keys(files).length).toBeGreaterThan(20)
    expect(bad).toEqual([])
    expect(wanted.filter((m) => !ids.has(m))).toEqual([])
  })
})
