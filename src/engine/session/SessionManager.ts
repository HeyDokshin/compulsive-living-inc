import { z } from 'zod'
import type { Game } from '../Game'
import { SaveService } from '../save/SaveService'
import { IndexedDbStorage, type SaveStorage } from '../save/storage'
import { decodeWorld, restoreEntities, saveFromJson, saveToJson } from '../save/codec'
import type { SaveData, SaveMeta } from '../save/format'
import { GAME_VERSION } from '../version'
import { createLogger } from '../util/log'

const log = createLogger('session')

export const DEFAULT_ISLAND = 'Мой остров'

export interface Session {
  /** Restored from a save (plugins skip first-time setup). */
  loaded: boolean
  slot: string
  /** The island's name. */
  name: string
  /** The player's name ('' = not given). */
  player: string
  createdAt: number
  /** Seconds of play. */
  playTime: number
  /** Only a backdrop for the title screen: never saved. */
  demo: boolean
}

export interface NewSessionOptions {
  seed?: number
  slot?: string
  name?: string
  player?: string
  demo?: boolean
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
  session: Session = { loaded: false, slot: 'slot1', name: DEFAULT_ISLAND, player: '', createdAt: Date.now(), playTime: 0, demo: true }
  /** True while a session is being (re)built — saving is skipped meanwhile. */
  switching = false
  private sinceSave = 0
  /** The last autosave failed (the player has been told). */
  private saveFailed = false

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
   * A save that fails to load leads back to the title screen instead of leaving a broken game.
   */
  start(save: SaveData | null, opts: NewSessionOptions = {}): Promise<void> {
    return this.game.serial(async () => {
      try {
        await this.build(save, opts)
      } catch (e) {
        if (!save) throw e
        log.error('loading the save failed, starting a fresh island:', e)
        // The broken save stays as it is: the fresh island is only a backdrop for the title screen.
        await this.build(null, { slot: save.meta.slot, demo: true })
        this.game.title.show('main', 'Не получилось загрузить сохранение — оно осталось нетронутым.')
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
        this.session = { loaded: true, slot: m.slot, name: m.name, player: m.player ?? '', createdAt: m.createdAt, playTime: m.playTime, demo: false }
        Object.assign(g.worldConfig, save.world.config) // silently: no regenerate-on-change
      } else {
        this.session = {
          loaded: false,
          slot: opts.slot ?? this.session.slot,
          name: opts.name || DEFAULT_ISLAND,
          player: opts.player ?? '',
          createdAt: Date.now(),
          playTime: 0,
          demo: opts.demo ?? false,
        }
        // a loaded island brings its own world settings: a new one starts from the config again
        const seed = opts.seed ?? g.worldConfig.seed
        g.config.resetToFile('world')
        g.world.cancelSoon()
        g.worldConfig.seed = seed
        g.time.reset() // a new island starts today
      }
      g.panel.refresh()
      await g.plugins.loadAll(async () => {
        g.reloadContent()
        await g.world.regenerate()
        if (save) {
          decodeWorld(save.world, g.world.voxels)
          this.saves.keepEntities(restoreEntities(save.entities, g.entities))
          this.saves.loadPlugins(save.plugins)
          g.renderer.chunks.update()
          g.events.emit('save:loaded', { slot: save.meta.slot })
        }
      })
      for (const id of g.plugins.loadedIds()) g.events.emit('plugin:loaded', { id })
      // Rooms nobody is in are open sea (older saves may still hold one).
      for (const id of g.interiors.ids()) if (id !== g.interiors.current) g.restoreSea(g.interiors.area(id))
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

  /** Mods a save was made with that are not working now. */
  missingMods(meta: SaveMeta): string[] {
    const active = new Set(this.game.mods.active().map((m) => m.id))
    return (meta.mods ?? []).filter((m) => !active.has(m.id)).map((m) => m.name)
  }

  /** Save the current island into a slot (default: the session's slot). */
  async save(slot = this.session.slot): Promise<SaveMeta | null> {
    if (this.switching || this.session.demo) return null
    const g = this.game
    const meta: SaveMeta = {
      slot,
      name: this.session.name,
      player: this.session.player,
      createdAt: this.session.createdAt,
      savedAt: Date.now(),
      playTime: Math.round(this.session.playTime),
      seed: g.worldConfig.seed,
      mods: g.mods.active(),
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
    await this.start(null, { ...opts, seed: opts.seed ?? Math.floor(Math.random() * 2 ** 31) })
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
    if (this.switching || this.game.title.visible.value) return
    if (!paused) this.session.playTime += dt
    const every = this.game.engineConfig.save.autosaveMinutes * 60
    if (every <= 0) return
    this.sinceSave += dt
    if (this.sinceSave >= every) {
      this.sinceSave = 0
      void this.save().then(
        () => (this.saveFailed = false),
        (e) => {
          log.error('autosave failed:', e)
          if (!this.saveFailed) this.game.ui.toast('Не получается сохранить игру: проверьте место на диске и настройки браузера', { ms: 6000 })
          this.saveFailed = true
        },
      )
    }
  }

  /** Also save when the tab is hidden (closing, switching apps). */
  installSaveOnHide(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && !this.game.title.visible.value && this.game.engineConfig.save.autosaveMinutes > 0) {
        void this.save().catch((e) => log.error('save on hide failed:', e))
      }
    })
  }
}
