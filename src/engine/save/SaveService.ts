import type { Dispose } from '../util/disposables'
import type { Entities } from '../ecs/Entities'
import type { VoxelWorld } from '../world/VoxelWorld'
import { createLogger } from '../util/log'
import { encodeWorld, serializeEntities } from './codec'
import { SAVE_FORMAT, type SaveData, type SavedEntity, type SaveMeta, type SavedPlugin } from './format'
import { migrateSave } from './migrations'

const log = createLogger('save')

/** How a plugin puts its own state into saves. */
export interface SaverDef<T = unknown> {
  /** Bump when the shape of `save()` output changes, and handle old versions in `migrate`. */
  version: number
  save(): T
  load(data: T): void
  /** Upgrade data written by an older version (called step by step is not required — you get `from`). */
  migrate?(data: unknown, from: number): T
}

/** Collects and distributes everything a save holds. Pure orchestration — storage lives elsewhere. */
export class SaveService {
  private savers = new Map<string, SaverDef & { owner: string }>()
  /** Saver keys that received data from the last loaded save. */
  readonly loadedKeys = new Set<string>()
  /** Data of plugins that are not loaded now — written back unchanged so it isn't lost. */
  private orphans: Record<string, SavedPlugin> = {}
  /** Entities that could not be spawned — written back too. */
  private lostEntities: SavedEntity[] = []
  /** What each saver last gave or got, in case it throws while saving. */
  private lastGood: Record<string, SavedPlugin> = {}

  register(key: string, def: SaverDef, owner: string): Dispose {
    if (this.savers.has(key) && this.savers.get(key)!.owner !== owner) throw new Error(`Saver "${key}" already registered`)
    this.savers.set(key, { ...def, owner })
    return () => {
      if (this.savers.get(key)?.owner === owner) this.savers.delete(key)
    }
  }

  keys(): string[] {
    return [...this.savers.keys()]
  }

  collect(meta: SaveMeta, world: VoxelWorld, worldConfig: Record<string, unknown>, entities: Entities): SaveData {
    const plugins: Record<string, SavedPlugin> = { ...structuredClone(this.orphans) }
    for (const [key, s] of this.savers) {
      try {
        this.lastGood[key] = plugins[key] = { version: s.version, data: structuredClone(s.save()) }
      } catch (e) {
        log.error(`saver "${key}" failed, keeping what it saved before:`, e)
        if (this.lastGood[key]) plugins[key] = this.lastGood[key]
      }
    }
    return {
      format: SAVE_FORMAT,
      meta,
      world: encodeWorld(world, worldConfig),
      entities: [...serializeEntities(entities), ...this.lostEntities],
      plugins,
    }
  }

  /** Current data of every saver (hot reload: plugins keep their state through a reload). */
  snapshot(): Record<string, SavedPlugin & { owner: string }> {
    const out: Record<string, SavedPlugin & { owner: string }> = {}
    for (const [key, s] of this.savers) {
      try {
        out[key] = { version: s.version, data: structuredClone(s.save()), owner: s.owner }
      } catch (e) {
        log.error(`saver "${key}" failed:`, e)
      }
    }
    return out
  }

  /**
   * Hand snapshot data back to the savers of the given (just reloaded) plugins. A plugin that did not
   * come back (broken code) keeps its data aside — until it does.
   */
  restore(snapshot: Record<string, SavedPlugin & { owner: string }>, owners: readonly string[]): void {
    const all: Record<string, SavedPlugin & { owner?: string }> = { ...this.orphans, ...snapshot }
    for (const [key, saved] of Object.entries(all)) {
      const s = this.savers.get(key)
      if (!s) {
        this.orphans[key] = { version: saved.version, data: saved.data }
        continue
      }
      if (!owners.includes(s.owner)) continue
      delete this.orphans[key]
      try {
        s.load(saved.version < s.version && s.migrate ? s.migrate(saved.data, saved.version) : saved.data)
      } catch (e) {
        log.error(`restoring "${key}" after reload failed:`, e)
      }
    }
  }

  /** Upgrade old save files to the current format. */
  upgrade(data: SaveData): SaveData {
    return migrateSave(data)
  }

  /** Hand each plugin its data (migrated if older). Returns keys that failed. */
  loadPlugins(plugins: Record<string, SavedPlugin>): string[] {
    const failed: string[] = []
    this.orphans = {}
    this.lastGood = {}
    this.loadedKeys.clear()
    for (const [key, saved] of Object.entries(plugins)) {
      const s = this.savers.get(key)
      if (!s) {
        this.orphans[key] = saved
        continue
      }
      try {
        let data = saved.data
        if (saved.version < s.version) {
          if (!s.migrate) throw new Error(`data is v${saved.version}, plugin is v${s.version} and has no migrate()`)
          data = s.migrate(data, saved.version)
        } else if (saved.version > s.version) {
          log.warn(`"${key}" data is newer (v${saved.version}) than the plugin (v${s.version}); trying anyway`)
        }
        s.load(data)
        this.loadedKeys.add(key)
        this.lastGood[key] = saved
      } catch (e) {
        failed.push(key)
        this.orphans[`${key}#unread`] = saved // not lost: it can be looked at or repaired
        log.error(`loading "${key}" failed:`, e)
      }
    }
    if (Object.keys(this.orphans).length) log.info(`kept data of missing plugins: ${Object.keys(this.orphans).join(', ')}`)
    return failed
  }

  /** Entities of the loaded save that could not be spawned. */
  keepEntities(list: SavedEntity[]): void {
    this.lostEntities = list
  }

  /** Forget orphans (new game). */
  reset(): void {
    this.orphans = {}
    this.lostEntities = []
    this.lastGood = {}
    this.loadedKeys.clear()
  }
}
