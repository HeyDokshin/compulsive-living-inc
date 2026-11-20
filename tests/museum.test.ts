import { readFileSync } from 'node:fs'
import JSON5 from 'json5'
import { describe, expect, it } from 'vitest'
import { floorBlock, parseHall } from '../src/plugins/museum/layout'
import { Interiors } from '../src/engine/world/Interiors'

describe('museum hall plan', () => {
  const file = JSON5.parse(readFileSync(new URL('../content/museum/museum.layouts.json5', import.meta.url), 'utf8')) as { entries: Array<{ id: string; rows: string[] }> }
  const hall = file.entries.find((e) => e.id === 'museum:hall')!
  const species = JSON5.parse(readFileSync(new URL('../content/collection/collection.species.json5', import.meta.url), 'utf8')) as { entries: Array<{ kind: string }> }
  const count = (kind: string) => species.entries.filter((s) => s.kind === kind).length

  it('has a slot for every species', () => {
    const plan = parseHall(hall.rows)
    expect(plan.width).toBe(16)
    expect(plan.depth).toBe(16)
    expect(plan.slots.fish.length).toBeGreaterThanOrEqual(count('fish'))
    expect(plan.slots.bug.length).toBeGreaterThanOrEqual(count('bug'))
    expect(plan.slots.fossil.length).toBeGreaterThanOrEqual(count('fossil'))
  })

  it('finds the entrance, doors, desk and blocked cells', () => {
    const plan = parseHall(hall.rows)
    expect(plan.spawn).toEqual({ x: 8, z: 14.5 })
    expect(plan.doors).toEqual([
      { x: 7, z: 15 },
      { x: 8, z: 15 },
    ])
    expect(plan.desks.length).toBe(2)
    expect(plan.curator).toEqual({ x: 8, z: 1.5 }) // behind the desk
    expect(plan.blocked.has('1,2')).toBe(true) // a fish tank
    expect(plan.blocked.has('7,14')).toBe(false) // where you appear
    expect(plan.slots.fish[0]).toEqual({ x: 1, z: 1 }) // reading order
  })

  it('rejects ragged plans and maps floors', () => {
    expect(() => parseHall(['###', '##'])).toThrow()
    expect(floorBlock('a', { '.': 'x:floor', a: 'x:carpet' })).toBe('x:carpet')
    expect(floorBlock('S', { '.': 'x:floor' })).toBe('x:floor')
  })
})

describe('interiors', () => {
  const make = () => new Interiors(() => ({ x: 8, z: 8 }))

  it('allocates world corners and keeps them', () => {
    const i = make()
    expect(i.area('museum')).toEqual({ x: 0, z: 0, w: 16, d: 16 })
    expect(i.area('house')).toEqual({ x: 112, z: 0, w: 16, d: 16 })
    expect(i.area('museum')).toEqual({ x: 0, z: 0, w: 16, d: 16 })
    const saved = i.save()
    const j = make()
    j.load(saved)
    expect(j.area('house')).toEqual({ x: 112, z: 0, w: 16, d: 16 })
    expect(j.area('third')).toEqual({ x: 0, z: 112, w: 16, d: 16 })
  })

  it('shows only the room inside, everything outside', () => {
    const i = make()
    const changes: Array<string | null> = []
    i.onChange = (id) => changes.push(id)
    i.area('museum')
    expect(i.chunkVisible(0, 0)).toBe(true) // outside, a room's corner is just sea
    expect(i.chunkVisible(3, 3)).toBe(true)
    i.enter('museum', { x: 60, y: 9, z: 61, rotY: 1 })
    expect(i.current).toBe('museum')
    expect(i.chunkVisible(0, 0)).toBe(true)
    expect(i.chunkVisible(3, 3)).toBe(false)
    expect(i.pointVisible(5.5, 9.5)).toBe(true)
    expect(i.pointVisible(60, 61)).toBe(false)
    expect(i.exit()).toEqual({ x: 60, y: 9, z: 61, rotY: 1 })
    expect(i.current).toBeNull()
    expect(i.exit()).toBeNull()
    expect(changes).toEqual(['museum', null])
  })

  it('remembers being inside across a save', () => {
    const i = make()
    i.enter('museum', { x: 1, y: 2, z: 3, rotY: 0 })
    const j = make()
    j.load(i.save())
    expect(j.current).toBe('museum')
    expect(j.exit()).toEqual({ x: 1, y: 2, z: 3, rotY: 0 })
  })
})
