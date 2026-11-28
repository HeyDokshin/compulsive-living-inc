import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { diff, dropEntry, fieldsOf, freeId, matches, packPath, putEntry, readPack, removedKeys, setField, slug, writePack } from '../src/plugins/editor/logic'

describe('content editor', () => {
  it('finds the smallest patch', () => {
    const base = { id: 'a:b', price: 1, held: { tilt: 0, scale: 1 }, tags: ['x'] }
    expect(diff(base, base)).toEqual({})
    expect(diff(base, { ...base, price: 2, held: { tilt: 0, scale: 2 }, tags: ['x', 'y'] })).toEqual({ price: 2, held: { scale: 2 }, tags: ['x', 'y'] })
    expect(removedKeys(base, { id: 'a:b', price: 1, held: { tilt: 0 } })).toEqual(['held.scale', 'tags'])
  })
  it('keeps own entries whole and others as patches', () => {
    let p = readPack({ entries: [{ id: 'm:a', n: 1 }], tags: { 't:t': ['m:a'] } })
    p = putEntry(p, { id: 'm:a', n: 2 }, null)
    p = putEntry(p, { id: 'm:b', n: 3 }, null)
    p = putEntry(p, { id: 'core:x', n: 5 }, { id: 'core:x', n: 4 })
    expect(p).toEqual({
      entries: [
        { id: 'm:a', n: 2 },
        { id: 'm:b', n: 3 },
      ],
      patch: { 'core:x': { n: 5 } },
      tags: { 't:t': ['m:a'] },
    })
    expect(readPack(JSON.parse(writePack(p)!))).toEqual(p)
    p = putEntry(p, { id: 'core:x', n: 4 }, { id: 'core:x', n: 4 }) // back to what it was
    expect(p.patch).toEqual({})
    expect(writePack(dropEntry(readPack([{ id: 'm:a' }]), 'm:a'))).toBeNull()
    expect(packPath('villagers:lines')).toBe('content/villagers.lines.json5')
    expect(packPath('items')).toBe('content/items.json5')
  })
  it('makes a form out of a schema and an entry', () => {
    const schema = z.toJSONSchema(
      z.looseObject({
        id: z.string(),
        name: z.string(),
        tags: z.array(z.string()).optional(),
        price: z.number().optional(),
        layer: z.enum(['floor', 'wall']).default('floor'),
        box: z.boolean().default(true),
      }),
      { io: 'input' },
    )
    const fields = fieldsOf(schema, { id: 'a:b', name: 'A', color: '#ff00aa', palette: { p: '#fff' }, lines: ['раз', 'два'] })
    expect(Object.fromEntries(fields.map((f) => [f.key, f.kind]))).toEqual({
      name: 'text',
      tags: 'lines',
      price: 'number',
      layer: 'choice',
      box: 'bool',
      color: 'color',
      palette: 'json',
      lines: 'lines',
    })
    expect(fields.find((f) => f.key === 'name')!.required).toBe(true)
    expect(fields.find((f) => f.key === 'layer')).toMatchObject({ options: ['floor', 'wall'], required: false })
  })
  it('helps with ids, search and fields', () => {
    expect(freeId('mine', 'core:apple', (id) => ['mine:apple', 'mine:apple_2'].includes(id))).toBe('mine:apple_3')
    expect(slug('Мой сад!')).toBe('moi_sad')
    expect(slug('7 ☀')).toBe('my_mod')
    expect(matches({ id: 'core:apple', name: 'Яблоко' }, 'ябл')).toBe(true)
    expect(matches({ id: 'core:apple', name: 'Яблоко' }, 'peach')).toBe(false)
    expect(setField({ a: 1, b: 2 }, 'a', undefined)).toEqual({ b: 2 })
  })
})
