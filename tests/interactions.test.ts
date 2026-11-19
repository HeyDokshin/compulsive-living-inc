import { describe, expect, it } from 'vitest'
import { Registry } from '../src/engine/registry/Registry'
import { Hooks } from '../src/engine/events/Hooks'
import { EventBus } from '../src/engine/events/EventBus'
import { Interactions, type InteractionContext, type InteractionDef } from '../src/engine/interact/Interactions'
import type { ItemDef } from '../src/engine/items/defs'
import type { BlockDef, GameEvents, GameHooks } from '../src/engine/types'

function setup() {
  const defs = new Registry<InteractionDef>('interactions')
  const items = new Registry<ItemDef>('items')
  const blocks = new Registry<BlockDef>('blocks')
  items.register({ id: 't:shovel', name: 'Shovel', stack: 1, tags: ['t:tools', 't:shovels'] } as ItemDef, 'x')
  items.register({ id: 't:apple', name: 'Apple', stack: 10, tags: ['t:fruits'] } as ItemDef, 'x')
  blocks.register({ id: 't:grass', color: '#0f0', tags: ['t:diggable'] } as BlockDef, 'x')
  blocks.register({ id: 't:stone', color: '#888' } as BlockDef, 'x')
  const hooks = new Hooks<GameHooks>()
  const events = new EventBus<GameEvents>()
  const log: string[] = []
  const add = (d: Partial<InteractionDef> & { id: string }) =>
    defs.register({ label: d.id, run: () => void log.push(d.id), ...d, id: `t:${d.id}` } as InteractionDef, 'x')
  return { defs, hooks, events, log, add, inter: new Interactions(defs, items, blocks, hooks, events) }
}

const ctx = (over: Partial<InteractionContext> = {}): InteractionContext => ({
  actor: {},
  held: null,
  x: 0,
  y: 0,
  z: 0,
  block: 't:grass',
  entities: [],
  ...over,
})

describe('interaction matrix', () => {
  it('matches tool by id/tag/null/any and block by id/tag', () => {
    const { add, inter } = setup()
    add({ id: 'dig', tool: '#t:shovels', block: '#t:diggable', priority: 10 })
    add({ id: 'eat', tool: '#t:fruits' })
    add({ id: 'pet', tool: null, block: 't:grass' })
    add({ id: 'any', priority: -100 })
    expect(inter.find(ctx({ held: 't:shovel' }))?.id).toBe('t:dig')
    expect(inter.find(ctx({ held: 't:shovel', block: 't:stone' }))?.id).toBe('t:any')
    expect(inter.find(ctx({ held: 't:apple' }))?.id).toBe('t:eat')
    expect(inter.find(ctx({ held: null }))?.id).toBe('t:pet')
    expect(inter.find(ctx({ held: null, block: 't:stone' }))?.id).toBe('t:any')
  })

  it('targets entities by component, respects priority, when() and run() === false', () => {
    const { add, inter, log } = setup()
    add({ id: 'pickup', entity: 'item', priority: 100 })
    add({ id: 'dig', tool: '#t:shovels', block: '#t:diggable', when: (c) => c.entities.length === 0 })
    add({ id: 'nothing', run: () => false })
    const drop = { item: { id: 't:apple', count: 1 } }
    const c = ctx({ held: 't:shovel', entities: [drop] })
    expect(inter.find(c)?.id).toBe('t:pickup')
    expect(c.target).toBe(drop)
    expect(inter.perform(ctx({ held: 't:shovel' }))?.id).toBe('t:dig')
    expect(inter.perform(ctx({ block: 't:stone' }))).toBe(null) // ran, but returned false
    expect(log).toEqual(['dig']) // 'nothing' has its own run() that returns false
  })

  it('a hook can override the result', () => {
    const { add, inter, hooks } = setup()
    add({ id: 'dig', tool: '#t:shovels' })
    hooks.tap('interaction:resolve', (def, c) => (c.block === 't:stone' ? null : def))
    expect(inter.find(ctx({ held: 't:shovel', block: 't:stone' }))).toBe(null)
    expect(inter.find(ctx({ held: 't:shovel' }))?.id).toBe('t:dig')
  })
})
