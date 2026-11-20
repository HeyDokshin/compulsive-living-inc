import { World } from 'miniplex'
import type { ZodType } from 'zod'
import { BlobShadowSchema, BlockerSchema, ModelSchema, SilhouetteSchema, TransformSchema, type Components, type Entity, type PrefabDef } from '../types'
import type { Registry } from '../registry/Registry'
import type { EventBus } from '../events/EventBus'
import type { Hooks } from '../events/Hooks'
import type { GameEvents, GameHooks } from '../types'
import { deepMerge } from '../util/objects'
import type { Dispose } from '../util/disposables'

export interface ComponentDef {
  name: string
  owner: string
  schema?: ZodType
  /** false = runtime only (three.js objects, caches): skipped by saves and the inspector. */
  persistent: boolean
}

/** Components every entity may have, known to the engine. */
const ENGINE_COMPONENTS: Omit<ComponentDef, 'owner'>[] = [
  { name: 'uid', persistent: true },
  { name: 'prefab', persistent: true },
  { name: 'name', persistent: true },
  { name: 'transform', schema: TransformSchema, persistent: true },
  { name: 'model', schema: ModelSchema, persistent: true },
  { name: 'view', persistent: false },
  { name: 'silhouette', schema: SilhouetteSchema, persistent: true },
  { name: 'blobShadow', schema: BlobShadowSchema, persistent: true },
  { name: 'blocker', schema: BlockerSchema, persistent: true },
]

/** ECS world (miniplex) + component schemas + prefab spawning. */
export class Entities {
  readonly world = new World<Entity>()
  private components = new Map<string, ComponentDef>()
  private nextUid = 1

  constructor(
    private prefabs: Registry<PrefabDef>,
    private events: EventBus<GameEvents>,
    private hooks: Hooks<GameHooks>,
  ) {
    for (const c of ENGINE_COMPONENTS) this.components.set(c.name, { ...c, owner: 'engine' })
  }

  define(name: string, owner: string, schema?: ZodType, persistent = true): Dispose {
    const existing = this.components.get(name)
    if (existing && existing.owner !== owner) {
      throw new Error(`Component "${name}" is already defined by "${existing.owner}"`)
    }
    this.components.set(name, { name, owner, schema, persistent })
    return () => {
      if (this.components.get(name)?.owner === owner) this.components.delete(name)
    }
  }

  componentDefs(): ComponentDef[] {
    return [...this.components.values()]
  }

  /** Resolve a prefab with its `extends` chain into a components object. */
  prefabComponents(id: string, seen = new Set<string>()): Components {
    if (seen.has(id)) throw new Error(`Prefab cycle: ${[...seen, id].join(' -> ')}`)
    seen.add(id)
    const def = this.prefabs.require(id)
    const parent = def.extends ? this.prefabComponents(def.extends, seen) : {}
    return deepMerge(parent, structuredClone(def.components)) as Components
  }

  /** Spawn from a prefab id (`player:player`) or from raw components. */
  spawn(source: string | Components, overrides: Components = {}): Entity {
    const prefab = typeof source === 'string' ? source : undefined
    let comps: Components = typeof source === 'string' ? this.prefabComponents(source) : structuredClone(source)
    comps = deepMerge(comps, overrides)
    if (prefab) comps.prefab = prefab
    comps = this.hooks.run('entity:beforeSpawn', comps, { prefab })
    comps = this.validate(comps)
    comps.uid ??= this.nextUid++
    if (comps.uid >= this.nextUid) this.nextUid = comps.uid + 1 // restored from a save
    const entity = this.world.add(comps)
    this.events.emit('entity:spawned', { entity })
    return entity
  }

  despawn(entity: Entity): void {
    if (!this.world.has(entity)) return
    this.world.remove(entity)
    this.events.emit('entity:despawned', { entity })
  }

  clear(): void {
    for (const e of [...this.world.entities]) this.despawn(e)
  }

  private validate(comps: Components): Components {
    const out: Record<string, unknown> = { ...comps }
    for (const [key, value] of Object.entries(out)) {
      const def = this.components.get(key)
      if (!def) {
        console.warn(`[entities] component "${key}" is not defined (api.components.define) — kept as-is`)
        continue
      }
      if (def.schema) {
        const r = def.schema.safeParse(value)
        if (!r.success) {
          const issues = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
          throw new Error(`Component "${key}" is invalid: ${issues}`)
        }
        out[key] = r.data
      }
    }
    return out as Components
  }
}
