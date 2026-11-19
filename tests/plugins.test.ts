import { describe, expect, it, vi } from 'vitest'
import { PluginManager, type PluginDefinition } from '../src/engine/plugins/PluginManager'

type Api = { id: string }

function setup() {
  const log: string[] = []
  const pm = new PluginManager<Api>((def) => ({ api: { id: def.id }, dispose: () => log.push(`dispose:${def.id}`) }))
  const def = (id: string, dependsOn: string[] = [], extra: Partial<PluginDefinition<Api>> = {}): PluginDefinition<Api> => ({
    id,
    dependsOn,
    setup: () => void log.push(`setup:${id}`),
    start: () => void log.push(`start:${id}`),
    ...extra,
  })
  return { pm, log, def }
}

describe('PluginManager', () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})

  it('loads in dependency order, setup before start, content between', async () => {
    const { pm, log, def } = setup()
    pm.register(def('villagers', ['core', 'nature']))
    pm.register(def('nature', ['core']))
    pm.register(def('core'))
    await pm.loadAll(() => void log.push('content'))
    expect(log).toEqual(['setup:core', 'setup:nature', 'setup:villagers', 'content', 'start:core', 'start:nature', 'start:villagers'])
  })

  it('skips plugins with missing deps, cycles or failing setup (and their dependents)', async () => {
    const { pm, def } = setup()
    pm.register(def('a', ['missing']))
    pm.register(def('x', ['y']))
    pm.register(def('y', ['x']))
    pm.register(def('broken', [], { setup: () => { throw new Error('nope') } }))
    pm.register(def('needs_broken', ['broken']))
    pm.register(def('ok'))
    await pm.loadAll()
    expect(pm.loadedIds()).toEqual(['ok'])
    expect(pm.states.get('a')?.state).toBe('skipped')
    expect(pm.states.get('broken')?.state).toBe('failed')
    expect(pm.states.get('needs_broken')?.state).toBe('skipped')
  })

  it('hot reload re-runs the plugin and its dependents only', async () => {
    const { pm, log, def } = setup()
    pm.register(def('core'))
    pm.register(def('nature', ['core']))
    pm.register(def('other'))
    await pm.loadAll()
    log.length = 0
    await pm.reload([def('nature', ['core'])])
    expect(log).toEqual(['dispose:nature', 'setup:nature', 'start:nature'])
    log.length = 0
    await pm.reload([def('core')])
    expect(log).toEqual(['dispose:nature', 'dispose:core', 'setup:core', 'setup:nature', 'start:core', 'start:nature'])
  })
})
