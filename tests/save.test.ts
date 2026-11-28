import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { decodeWorld, encodeWorld, restoreEntities, rleDecode, rleEncode, saveFromJson, saveToJson, serializeEntities } from '../src/engine/save/codec'
import { SaveService } from '../src/engine/save/SaveService'
import { MemoryStorage } from '../src/engine/save/storage'
import { migrateSave } from '../src/engine/save/migrations'
import { SAVE_FORMAT, type SaveData } from '../src/engine/save/format'
import { VoxelWorld } from '../src/engine/world/VoxelWorld'
import { Entities } from '../src/engine/ecs/Entities'
import { Registry } from '../src/engine/registry/Registry'
import { EventBus } from '../src/engine/events/EventBus'
import { Hooks } from '../src/engine/events/Hooks'
import type { GameEvents, GameHooks, PrefabDef } from '../src/engine/types'

const entities = () => new Entities(new Registry<PrefabDef>('prefabs'), new EventBus<GameEvents>(), new Hooks<GameHooks>())
const meta = { slot: 'slot1', name: 'Test', createdAt: 1, savedAt: 2, playTime: 3, seed: 42, gameVersion: 't' }

describe('save codec', () => {
  it('run-length encodes and decodes', () => {
    const data = new Uint16Array([0, 0, 0, 5, 5, 1, 0, 0])
    const rle = rleEncode(data)
    expect([...rle]).toEqual([0, 3, 5, 2, 1, 1, 0, 2])
    const out = new Uint16Array(8)
    rleDecode(rle, out)
    expect([...out]).toEqual([...data])
    expect(() => rleDecode(rle, new Uint16Array(9))).toThrow(/mismatch/)
  })

  it('round-trips voxels through ids, even when palette numbers differ', () => {
    const a = new VoxelWorld()
    a.palette.num('t:sand')
    a.reset(2, 2, 8)
    a.setId(3, 2, 5, 't:grass')
    a.setId(20, 7, 30, 't:water')
    const saved = encodeWorld(a, { seed: 1 })
    expect(saved.voxels.length).toBeLessThan(40) // mostly air → tiny

    const b = new VoxelWorld()
    b.palette.num('t:water') // different numbering in the new session
    b.palette.num('t:grass')
    b.reset(2, 2, 8)
    decodeWorld(saved, b)
    expect(b.getId(3, 2, 5)).toBe('t:grass')
    expect(b.getId(20, 7, 30)).toBe('t:water')
    expect(b.getId(0, 0, 0)).toBe('air')
  })

  it('saves persistent components only, restores uids, keeps unknown components', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const src = entities()
    src.define('pocket', 'test', z.object({ n: z.number() }))
    src.spawn({ name: 'a', transform: { x: 1, y: 2, z: 3, rotY: 0 }, view: {} as never } as never)
    const e2 = src.spawn({ pocket: { n: 7 }, mystery: { from: 'removed mod' } } as never)
    const saved = serializeEntities(src)
    expect(saved).toHaveLength(2)
    expect(saved[0]!.components.view).toBeUndefined()

    const dst = entities()
    dst.define('pocket', 'test', z.object({ n: z.number() }))
    expect(restoreEntities(saved, dst)).toEqual([])
    const restored = dst.world.entities[1]!
    expect(restored.uid).toBe(e2.uid)
    expect((restored as Record<string, unknown>).mystery).toEqual({ from: 'removed mod' })
    expect(dst.spawn({ name: 'new' }).uid).toBe(3) // continues after restored uids
  })

  it('exports to JSON and back (typed arrays as base64)', () => {
    const data = { voxels: new Uint32Array([1, 2, 3, 4000000000]), n: 1 }
    const back = saveFromJson<typeof data>(saveToJson(data))
    expect(back.voxels).toBeInstanceOf(Uint32Array)
    expect([...back.voxels]).toEqual([1, 2, 3, 4000000000])
  })
})

describe('SaveService', () => {
  it('collects plugin data, migrates old versions, keeps data of missing plugins', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const world = new VoxelWorld()
    world.reset(1, 1, 4)
    const ents = entities()

    const v1 = new SaveService()
    let holes = [[1, 2]]
    v1.register('tools', { version: 1, save: () => holes, load: (d) => void (holes = d as number[][]) }, 'tools')
    v1.register('gone', { version: 1, save: () => ({ secret: 1 }), load: () => {} }, 'gone')
    const data = v1.collect(meta, world, { seed: 42 }, ents)
    const storage = new MemoryStorage()
    await storage.write(data)
    expect((await storage.list())[0]!.slot).toBe('slot1')

    // Next version of the game: "tools" now stores objects; "gone" plugin was removed.
    const v2 = new SaveService()
    let loaded: unknown
    v2.register(
      'tools',
      {
        version: 2,
        save: () => loaded,
        load: (d) => void (loaded = d),
        migrate: (d, from) => (from === 1 ? (d as number[][]).map(([x, z]) => ({ x, z })) : d),
      },
      'tools',
    )
    const failed = v2.loadPlugins((await storage.read('slot1'))!.plugins)
    expect(failed).toEqual([])
    expect(loaded).toEqual([{ x: 1, z: 2 }])
    const again = v2.collect(meta, world, {}, ents)
    expect(again.plugins.gone).toEqual({ version: 1, data: { secret: 1 } }) // not lost
    expect(again.plugins.tools!.version).toBe(2)
  })

  it('keeps what can not be read or written, instead of losing it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const world = new VoxelWorld()
    world.reset(1, 1, 4)
    const ents = entities()
    ents.define('pocket', 'test', z.object({ n: z.number() }))
    const s = new SaveService()
    // an entity whose component changed shape, a saver that can't read its data, one that can't write
    const odd = { components: { uid: 9, pocket: { n: 'seven' } } }
    s.keepEntities(restoreEntities([odd, { components: { pocket: { n: 1 } } }], ents))
    s.register(
      'picky',
      {
        version: 1,
        save: () => 'fresh',
        load: () => {
          throw new Error('what is this')
        },
      },
      'picky',
    )
    let broken = false
    s.register(
      'shaky',
      {
        version: 1,
        save: () => {
          if (broken) throw new Error('oops')
          return 'new'
        },
        load: () => {},
      },
      'shaky',
    )
    expect(s.loadPlugins({ picky: { version: 1, data: 'old' }, shaky: { version: 1, data: 'before' } })).toEqual(['picky'])
    broken = true
    const out = s.collect(meta, world, {}, ents)
    expect(out.entities).toHaveLength(2)
    expect(out.entities).toContainEqual(odd)
    expect(out.plugins['picky#unread']).toEqual({ version: 1, data: 'old' })
    expect(out.plugins.shaky).toEqual({ version: 1, data: 'before' })
    s.reset()
    expect(s.collect(meta, world, {}, ents).entities).toHaveLength(1)
  })

  it('a plugin that fails to come back after a reload gets its data when it does', () => {
    const world = new VoxelWorld()
    world.reset(1, 1, 4)
    const s = new SaveService()
    const off = s.register('hives', { version: 1, save: () => 'honey', load: () => {} }, 'hives')
    const snap = s.snapshot()
    off() // unloaded; its new code throws in setup
    s.restore(snap, [])
    expect(s.collect(meta, world, {}, entities()).plugins.hives).toEqual({ version: 1, data: 'honey' })
    let got: unknown
    s.register('hives', { version: 1, save: () => got, load: (d) => void (got = d) }, 'hives')
    s.restore(s.snapshot(), ['other']) // somebody else reloads: not ours yet
    s.restore({}, ['hives'])
    expect(got).toBe('honey')
  })

  it('refuses newer save formats and passes current ones through', () => {
    const d = { format: SAVE_FORMAT } as SaveData
    expect(migrateSave(d)).toBe(d)
    expect(() => migrateSave({ format: SAVE_FORMAT + 1 } as SaveData)).toThrow(/newer/)
  })

  it('keeps islands from before world levels one block above the sea', () => {
    const old = { format: 1, world: { config: { seed: 5 } } } as unknown as SaveData
    expect(migrateSave(old).world.config).toEqual({ ground: 9, sea: 8, seed: 5 })
    expect(migrateSave(old).format).toBe(SAVE_FORMAT)
  })
})
