import { z } from 'zod'
import type { Game } from '../Game'
import { SaveService } from '../save/SaveService'
import { IndexedDbStorage, type SaveStorage } from '../save/storage'
import { decodeWorld, restoreEntities, saveFromJson, saveToJson } from '../save/codec'
import type { SaveData, SaveMeta } from '../save/format'
import { GAME_VERSION } from '../version'
import { createLogger } from '../util/log'

const log = createLogger('session')

export interface Session {
  /** Restored from a save (plugins skip first-time setup). */
  loaded: boolean
  slot: string
  name: string
  createdAt: number
  /** Seconds of play. */
  playTime: number
}

export interface NewSessionOptions {
  seed?: number
  slot?: string
  name?: string
}

/** Shape check for save files coming from outside (imports), before anything touches the game. */
const SaveShape = z.object({
  format: z.number(),
  meta: z.object({ slot: z.string(), name: z.string(), createdAt: z.number(), savedAt: z.number(), playTime: z.number(), seed: z.number() }).loose(),
  world: z
    .object({
      config: z.record(z.string(), z.unknown()),
      palette: z.array(z.string()),
      chunksX: z.number().int().positive(),
      chunksZ: z.number().int().positive(),
      height: z.number().int().positive(),
      voxels: z.instanceof(Uint32Array),
    })
    .loose(),
  entities: z.array(z.object({ components: z.record(z.string(), z.unknown()) })),
  plugins: z.record(z.string(), z.object({ version: z.number(), data: z.unknown() })),
})

/**
 * The island being played and its saves: new game, load (as a clean session restart), save,
 * autosave, slots, export/import. All switches go through the game's task queue.
 */
export class SessionManager {
  readonly saves = new SaveService()
  storage: SaveStorage = new IndexedDbStorage()
  session: Session = { loaded: false, slot: 'slot1', name: 'Мой остров', createdAt: Date.now(), playTime: 0 }
  /** True while a session is being (re)built — saving is skipped meanwhile. */
  switching = false
  private sinceSave = 0

  constructor(private game: Game) {}

  /** The most recent save, if continuing is enabled and one exists. */
  async latest(): Promise<SaveData | null> {
    if (!this.game.engineConfig.save.autoLoad) return null
    try {
      const meta = (await this.storage.list())[0]
      return meta ? await this.storage.read(meta.slot) : null
    } catch (e) {
      log.error('could not read saves:', e)
      return null
    }
  }

  /**
   * (Re)build the whole game: unload plugins, clear entities, then load plugins again on top of
   * either a fresh island or a save (world voxels → entities → plugin data → plugin start).
   * A save that fails to load falls back to a fresh island instead of leaving a broken game.
   */
  start(save: SaveData | null, opts: NewSessionOptions = {}): Promise<void> {
    return this.game.serial(async () => {
      try {
        await this.build(save, opts)
      } catch (e) {
        if (!save) throw e
        log.error('loading the save failed, starting a fresh island:', e)
        await this.build(null, { slot: save.meta.slot })
        this.game.ui.toast('Не получилось загрузить сохранение — начат новый остров')
      }
    })
  }

  private async build(save: SaveData | null, opts: NewSessionOptions): Promise<void> {
    const g = this.game
    this.switching = true
    try {
      if (save) save = this.saves.upgrade(save)
      g.plugins.unloadAll()
      g.entities.clear()
      g.camera.follow = null
      this.saves.reset()
      g.interiors.reset()
      g.ui.close()
      if (save) {
        const m = save.meta
        this.session = { loaded: true, slot: m.slot, name: m.name, createdAt: m.createdAt, playTime: m.playTime }
        Object.assign(g.worldConfig, save.world.config) // silently: no regenerate-on-change
      } else {
        this.session = { loaded: false, slot: opts.slot ?? this.session.slot, name: opts.name ?? 'Мой остров', createdAt: Date.now(), playTime: 0 }
        if (opts.seed !== undefined) g.worldConfig.seed = opts.seed
        g.time.reset() // a new island starts today
      }
      g.panel.refresh()
      await g.plugins.loadAll(async () => {
        g.reloadContent()
        await g.world.regenerate()
        if (save) {
          decodeWorld(save.world, g.world.voxels)
          restoreEntities(save.entities, g.entities)
          this.saves.loadPlugins(save.plugins)
          g.renderer.chunks.update()
          g.events.emit('save:loaded', { slot: save.meta.slot })
        }
      })
      for (const id of g.plugins.loadedIds()) g.events.emit('plugin:loaded', { id })
      g.panel.sync()
      g.camera.placed = false
      if (!g.camera.follow) g.camera.center()
      this.sinceSave = 0
      g.events.emit('session:started', { loaded: !!save, slot: this.session.slot })
      g.time.flushCatchUp() // days that passed while away (plugins are listening now)
      log.info(save ? `loaded "${save.meta.name}" (${save.meta.slot})` : `new island, seed ${g.worldConfig.seed}`)
    } finally {
      this.switching = false
    }
  }

  /** Save the current island into a slot (default: the session's slot). */
  async save(slot = this.session.slot): Promise<SaveMeta | null> {
    if (this.switching) return null
    const g = this.game
    const meta: SaveMeta = {
      slot,
      name: this.session.name,
      createdAt: this.session.createdAt,
      savedAt: Date.now(),
      playTime: Math.round(this.session.playTime),
      seed: g.worldConfig.seed,
      gameVersion: GAME_VERSION,
    }
    const data = this.saves.collect(meta, g.world.voxels, g.worldConfig, g.entities)
    await this.storage.write(data)
    this.session.slot = slot
    this.sinceSave = 0
    g.events.emit('save:saved', { slot })
    return meta
  }

  async load(slot: string): Promise<void> {
    const data = await this.storage.read(slot)
    if (!data) throw new Error(`slot "${slot}" is empty`)
    await this.start(data)
  }

  async newGame(opts: NewSessionOptions = {}): Promise<void> {
    await this.start(null, { seed: opts.seed ?? Math.floor(Math.random() * 2 ** 31), slot: opts.slot, name: opts.name })
    await this.save()
  }

  async exportSlot(slot: string): Promise<string> {
    const data = await this.storage.read(slot)
    if (!data) throw new Error(`slot "${slot}" is empty`)
    return saveToJson(data)
  }

  /** Import a save file into a slot. Rejects files that don't look like saves before writing anything. */
  async importInto(text: string, slot: string): Promise<void> {
    let parsed: unknown
    try {
      parsed = saveFromJson(text)
    } catch {
      throw new Error('это не файл сохранения (не JSON)')
    }
    const check = SaveShape.safeParse(parsed)
    if (!check.success) throw new Error('файл сохранения повреждён или не от этой игры')
    const data = this.saves.upgrade(parsed as SaveData)
    data.meta = { ...data.meta, slot }
    await this.storage.write(data)
  }

  slotIds(): string[] {
    return Array.from({ length: this.game.engineConfig.save.slots }, (_, i) => `slot${i + 1}`)
  }

  /** Per frame: play time and timed autosave. */
  tick(dt: number, paused: boolean): void {
    if (this.switching) return
    if (!paused) this.session.playTime += dt
    const every = this.game.engineConfig.save.autosaveMinutes * 60
    if (every <= 0) return
    this.sinceSave += dt
    if (this.sinceSave >= every) {
      this.sinceSave = 0
      void this.save().catch((e) => log.error('autosave failed:', e))
    }
  }

  /** Also save when the tab is hidden (closing, switching apps). */
  installSaveOnHide(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.game.engineConfig.save.autosaveMinutes > 0) {
        void this.save().catch((e) => log.error('save on hide failed:', e))
      }
    })
  }
}
