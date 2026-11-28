import { deflateRawSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { ContentLoader } from '../src/engine/content/ContentLoader'
import { joinPath, rewriteImports, shimSource } from '../src/engine/mods/code'
import { ModManager } from '../src/engine/mods/ModManager'
import { MemoryModStore } from '../src/engine/mods/ModStore'
import { contentPaths, groupFolders, orderMods, parseManifest, stripRoot } from '../src/engine/mods/package'
import { crc32, readZip, writeZip } from '../src/engine/mods/zip'
import { RegistryHub } from '../src/engine/registry/RegistryHub'
import { ItemDefSchema } from '../src/engine/items/defs'
import { afterNight } from '../mods/beehives/lib/honey.js'

const bytes = (s: string) => new TextEncoder().encode(s)
const text = (b: Uint8Array | undefined) => new TextDecoder().decode(b)
const MB = 1024 * 1024

/** A zip with one deflated file (what real archivers write). */
function deflated(name: string, data: Uint8Array): Uint8Array {
  const zip = writeZip({ [name]: new Uint8Array(deflateRawSync(data)) })
  const v = new DataView(zip.buffer)
  const central = v.getUint32(zip.length - 22 + 16, true)
  for (const [at, p] of [
    [0, 0],
    [central, 2],
  ] as const) {
    v.setUint16(at + 8 + p, 8, true)
    v.setUint32(at + 14 + p, crc32(data), true)
    v.setUint32(at + 22 + p, data.length, true)
  }
  return zip
}

describe('zip', () => {
  it('round-trips files with any names', async () => {
    const files = { 'mod.json5': bytes('{}'), 'content/предметы.json5': bytes('[1]'), 'empty.txt': new Uint8Array() }
    const out = await readZip(writeZip(files), MB)
    expect(Object.keys(out).sort()).toEqual(Object.keys(files).sort())
    expect(text(out['content/предметы.json5'])).toBe('[1]')
  })
  it('unpacks deflated entries and stops at the size limit', async () => {
    const data = bytes('мёд '.repeat(5000))
    expect(text((await readZip(deflated('a.txt', data), MB))['a.txt'])).toBe(text(data))
    await expect(readZip(deflated('a.txt', data), 1000)).rejects.toThrow('слишком большой')
    await expect(readZip(writeZip({ a: new Uint8Array(2000) }), 1000)).rejects.toThrow('слишком большой')
  })
  it('refuses what is not a zip, broken ones and paths that climb out', async () => {
    await expect(readZip(bytes('hello'), MB)).rejects.toThrow('не zip')
    await expect(readZip(writeZip({ '../x': bytes('1') }), MB)).rejects.toThrow('недопустимый путь')
    const zip = writeZip({ a: bytes('12345') })
    zip[0] = 0
    await expect(readZip(zip, MB)).rejects.toThrow('повреждён')
  })
})

describe('mod packages', () => {
  it('checks manifests and says what is wrong', () => {
    expect(parseManifest(`{ id: 'bees', name: 'Пчёлы' }`)).toMatchObject({ id: 'bees', version: '1.0.0', sdk: 1, dependsOn: [], enabled: true })
    expect(() => parseManifest(`{ id: 'Bees', name: 'x' }`)).toThrow('id')
    expect(() => parseManifest(`{ id: 'bees', name: 'x', sdk: 99 }`)).toThrow('SDK 99')
    expect(() => parseManifest(`oops`)).toThrow('mod.json5')
  })
  it('finds the root inside a zip and groups folders', () => {
    expect(stripRoot({ 'bees-main/mod.json5': 1, 'bees-main/content/items.json5': 2, '__MACOSX/x': 3 })).toEqual({ 'mod.json5': 1, 'content/items.json5': 2 })
    expect(() => stripRoot({ 'a.txt': 1 })).toThrow('mod.json5')
    expect(groupFolders({ '/mods/a/mod.json5': 1, '/mods/a/content/x.json5': 2, '/mods/b/mod.json5': 3 }).get('a')).toEqual({
      'mod.json5': 1,
      'content/x.json5': 2,
    })
    expect(contentPaths('a', { 'content/items.json5': 1, 'main.js': 2 })).toEqual({ '/content/a/items.json5': 1 })
  })
  it('orders by dependencies and reports missing ones and cycles', () => {
    const m = (id: string, ...dependsOn: string[]) => parseManifest(JSON.stringify({ id, name: id, dependsOn }))
    const { order, problems } = orderMods(
      [m('a_mod', 'b_mod', 'items'), m('b_mod'), m('c_mod', 'nope'), m('d_mod', 'c_mod'), m('x1', 'x2'), m('x2', 'x1')],
      (id) => id === 'items',
    )
    expect(order.map((x) => x.id)).toEqual(['b_mod', 'a_mod'])
    expect([...problems.keys()].sort()).toEqual(['c_mod', 'd_mod', 'x1', 'x2'])
  })
})

describe('mod code', () => {
  it('rewrites imports and nothing else', () => {
    const src = `import { definePlugin,\n  z } from '@sdk'\nimport './side.js'\nexport * from "./lib/a.js"\nconst t = "gift from 'Bob'"\nconst m = await import('./b.js')\n`
    const seen: string[] = []
    const out = rewriteImports(src, (s) => (seen.push(s), `<${s}>`))
    expect(seen).toEqual(['@sdk', './side.js', './lib/a.js', './b.js'])
    expect(out).toContain(`gift from 'Bob'`)
    expect(out).toContain(`from '<@sdk>'`)
  })
  it('resolves relative paths inside the mod only', () => {
    expect(joinPath('src/main.js', './lib/a.js')).toBe('src/lib/a.js')
    expect(joinPath('src/main.js', '../b.js')).toBe('b.js')
    expect(() => joinPath('main.js', '../x.js')).toThrow('за пределы')
    expect(shimSource('G', ['z', 'ui'])).toContain('export const ui = m["ui"];')
  })
  it('example: hives fill up to the limit', () => {
    const cfg = { flowersPerJar: 3, maxJars: 3 }
    expect(afterNight(0, 2, cfg)).toBe(0)
    expect(afterNight(0, 7, cfg)).toBe(2)
    expect(afterNight(2, 7, cfg)).toBe(3)
  })
})

describe('ModManager', () => {
  const make = () => {
    const mods = new ModManager({ isBuiltIn: (id) => ['items', 'core'].includes(id), sdk: {}, maxBytes: () => MB })
    mods.store = new MemoryModStore()
    return mods
  }
  const zip = (manifest: object, files: Record<string, string> = {}) =>
    writeZip(Object.fromEntries(Object.entries({ 'mod.json5': JSON.stringify(manifest), ...files }).map(([k, v]) => [k, bytes(v)])))

  it('installs a data mod, gives its files, switches off and removes', async () => {
    const mods = make()
    await mods.init({}, {})
    const opened = await mods.open(
      zip({ id: 'sweets', name: 'Сладости' }, { 'content/items.json5': '[]', 'config/player.json5': '{ walkSpeed: 9, a: { b: 1 } }' }),
    )
    await mods.install(opened.manifest, opened.files)
    expect(await mods.activate()).toEqual([])
    expect(mods.contentFiles()).toEqual({ '/content/sweets/items.json5': '[]' })
    expect(mods.mergeConfig('player', { walkSpeed: 3, a: { c: 2 } })).toEqual({ walkSpeed: 9, a: { b: 1, c: 2 } })
    expect(mods.active()).toEqual([{ id: 'sweets', name: 'Сладости', version: '1.0.0' }])
    mods.setEnabled('sweets', false)
    await mods.activate()
    expect(mods.contentFiles()).toEqual({})
    await mods.remove('sweets')
    expect(mods.list()).toEqual([])
    expect(await mods.store.all()).toEqual([])
  })
  it('creates and edits a mod; refuses taken ids; stays out in safe mode', async () => {
    const mods = make()
    await mods.init({}, {})
    await expect(mods.create({ id: 'items', name: 'x' })).rejects.toThrow('занят')
    await mods.create({ id: 'mine', name: 'Мой' })
    await mods.write('mine', 'content/items.json5', '[]')
    expect(mods.contentFiles()).toEqual({ '/content/mine/items.json5': '[]' })
    const again = make()
    again.store = mods.store
    await again.init({}, {})
    expect(again.read('mine', 'content/items.json5')).toBe('[]')
    expect(text((await readZip(await again.exportZip('mine'), MB))['content/items.json5'])).toBe('[]')
    again.safeMode = true
    await again.activate()
    expect(again.contentFiles()).toEqual({})
  })
  it('shows folder mods and keeps them off when they say so', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const mods = make()
    await mods.init({ '/mods/a_mod/mod.json5': `{ id: 'a_mod', name: 'A', enabled: false }`, '/mods/wrong/mod.json5': `{ id: 'other', name: 'B' }` }, {})
    expect(mods.list().map((m) => [m.id, m.source, m.enabled])).toEqual([['a_mod', 'folder', false]])
    await expect(mods.write('a_mod', 'x.json5', '')).rejects.toThrow('нельзя менять')
  })
})

describe('content patches', () => {
  it('change entries of other packs and come off again with one pack reloaded', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const hub = new RegistryHub()
    const items = hub.create('items', ItemDefSchema as never, 'engine')
    const loader = new ContentLoader(hub)
    const errors: string[] = []
    loader.onError = (pack, message) => errors.push(`${pack} ${message}`)
    const base = { '/content/core/items.json5': `[{ id: 'core:apple', name: 'Яблоко', price: 100 }]` }
    loader.setFiles({
      ...base,
      '/content/mine/items.json5': `{ patch: { 'core:apple': { price: 150 } }, entries: [{ id: 'mine:pie', name: 'Пирог' }, { id: 'Bad' }] }`,
    })
    loader.reloadAll()
    expect(items.get('core:apple')).toMatchObject({ name: 'Яблоко', price: 150 })
    expect(items.without('core:apple', 'content:mine')).toMatchObject({ price: 100 })
    expect(items.ownerOf('mine:pie')).toBe('content:mine')
    expect(errors).toHaveLength(1)
    loader.setFiles({ ...base, '/content/mine/items.json5': `{ patch: { 'core:apple': { price: -5 } } }` })
    loader.reloadPack('mine')
    expect(items.get('core:apple')).toMatchObject({ price: 100 }) // not valid: the original stays
    expect(items.has('mine:pie')).toBe(false)
    expect(items.check({ id: 'x', price: -1 } as never).length).toBeGreaterThan(1)
  })
})
