import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { Registry } from '../src/engine/registry/Registry'
import { RegistryHub } from '../src/engine/registry/RegistryHub'

const Item = z.looseObject({ id: z.string(), tags: z.array(z.string()).optional(), price: z.number().default(0) })
type Item = z.infer<typeof Item>

describe('Registry', () => {
  it('registers, validates and applies defaults', () => {
    const r = new Registry<Item>('items', Item as z.ZodType<Item>)
    r.register({ id: 'core:apple' } as Item, 'core')
    expect(r.get('core:apple')!.price).toBe(0)
    expect(() => r.register({ id: 'bad id' } as Item, 'core')).toThrow(/Invalid id/)
    expect(() => r.register({ id: 'core:apple' } as Item, 'mod')).toThrow(/already registered/)
  })

  it('layers patches (even before registration) and removes them per owner', () => {
    const r = new Registry<Item>('items')
    r.modify('core:apple', (e) => ({ ...e, price: e.price * 2 }), 'mod_a', 10)
    r.register({ id: 'core:apple', price: 100 }, 'core')
    r.modify('core:apple', (e) => ({ ...e, price: e.price + 1 }), 'mod_b', 0)
    expect(r.get('core:apple')!.price).toBe(202) // +1 first (priority 0), then *2
    r.removeOwner('mod_a')
    expect(r.get('core:apple')!.price).toBe(101)
  })

  it('resolves tags and ids, and cleans up tags of removed owners', () => {
    const r = new Registry<Item>('items')
    r.register({ id: 'core:apple', price: 1, tags: ['core:fruits'] }, 'core')
    r.register({ id: 'mod:mango', price: 1 }, 'mod')
    r.tag('#core:fruits', ['mod:mango'], 'mod')
    expect(
      r
        .resolve('#core:fruits')
        .map((e) => e.id)
        .sort(),
    ).toEqual(['core:apple', 'mod:mango'])
    expect(r.resolve('core:apple')).toHaveLength(1)
    r.removeOwner('mod')
    expect(r.resolve('#core:fruits').map((e) => e.id)).toEqual(['core:apple'])
  })

  it('hub drops registries created by an owner', () => {
    const hub = new RegistryHub()
    hub.create('fishing:baits', undefined, 'fishing')
    expect(hub.has('fishing:baits')).toBe(true)
    hub.removeOwner('fishing')
    expect(hub.has('fishing:baits')).toBe(false)
    expect(() => hub.create('nonamespace', undefined, 'fishing')).toThrow()
  })
})
