import type { Dispose } from '../util/disposables'
import type { Entities } from '../ecs/Entities'
import type { VoxelWorld } from '../world/VoxelWorld'
import { createLogger } from '../util/log'
import { encodeWorld, serializeEntities } from './codec'
import { SAVE_FORMAT, type SaveData, type SaveMeta, type SavedPlugin } from './format'
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
  /** Data of plugins that are not loaded now — written back unchanged so it isn't lost. */
  private orphans: Record<string, SavedPlugin> = {}

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
        plugins[key] = { version: s.version, data: structuredClone(s.save()) }
      } catch (e) {
        log.error(`saver "${key}" failed:`, e)
      }
    }
    return {
      format: SAVE_FORMAT,
      meta,
      world: encodeWorld(world, worldConfig),
      entities: serializeEntities(entities),
      plugins,
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
      } catch (e) {
        failed.push(key)
        log.error(`loading "${key}" failed:`, e)
      }
    }
    if (Object.keys(this.orphans).length) log.info(`kept data of missing plugins: ${Object.keys(this.orphans).join(', ')}`)
    return failed
  }

  /** Forget orphans (new game). */
  reset(): void {
    this.orphans = {}
  }
}
