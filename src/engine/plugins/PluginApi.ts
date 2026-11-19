import type { ZodType } from 'zod'
import type * as THREE from 'three'
import type { World } from 'miniplex'
import type { RegistryEntry, RegistryView } from '../registry/Registry'
import type { SystemDef } from '../loop/Scheduler'
import type { Components, Entity, GameEvents, GameHooks, Registries, CommandDef } from '../types'
import type { Dispose } from '../util/disposables'
import type { Logger } from '../util/log'
import type { IsoCamera } from '../render/IsoCamera'
import type { EngineConfig } from '../engineConfig'
import type { PlainObject } from '../util/objects'
import type { VoxelWorld } from '../world/VoxelWorld'
import type { PatternFn } from '../render/textures'

/**
 * Everything a plugin can do. Every registration made through this object belongs to the plugin
 * and is removed automatically when it unloads or hot-reloads — no manual cleanup needed.
 */
export interface PluginApi {
  /** Plugin id = namespace. */
  readonly id: string
  readonly log: Logger
  /** Read-only engine settings (camera, light, loop). */
  readonly engineConfig: Readonly<EngineConfig>

  /** A built-in or plugin registry: `api.registry('blocks')`, `api.registry('fishing:baits')`. */
  registry<K extends keyof Registries & string>(name: K): RegistryView<Registries[K] & RegistryEntry>
  /** Create a registry other plugins and content packs can add to. Name must be `<plugin id>:<name>`. */
  createRegistry<T extends RegistryEntry>(name: string, schema?: ZodType<T>): RegistryView<T>

  events: {
    on<K extends keyof GameEvents>(name: K, fn: (payload: GameEvents[K]) => void): Dispose
    once<K extends keyof GameEvents>(name: K, fn: (payload: GameEvents[K]) => void): Dispose
    emit<K extends keyof GameEvents>(name: K, payload: GameEvents[K]): void
  }

  hooks: {
    tap<K extends keyof GameHooks>(
      name: K,
      fn: (value: GameHooks[K]['value'], ctx: GameHooks[K]['ctx']) => GameHooks[K]['value'],
      opts?: { priority?: number },
    ): Dispose
    run<K extends keyof GameHooks>(name: K, value: GameHooks[K]['value'], ctx: GameHooks[K]['ctx']): GameHooks[K]['value']
  }

  systems: {
    /** `id` is prefixed with the plugin namespace if it has none. */
    add(def: SystemDef): Dispose
  }

  components: {
    /** Declare a component: its schema validates spawns and drives saves/inspector. */
    define(name: keyof Components & string, schema?: ZodType, opts?: { persistent?: boolean }): void
  }

  entities: {
    readonly world: World<Entity>
    spawn(source: string | Components, overrides?: Components): Entity
    despawn(entity: Entity): void
  }

  config: {
    /** Define this plugin's config (`config/<id>.json5`). Returns live values, tunable in the debug panel. */
    define<T extends PlainObject>(schema: ZodType<T>): T
    onChange(fn: () => void): Dispose
  }

  input: {
    /** Declare an action with default keys (`KeyboardEvent.code`). Id is namespaced automatically. */
    action(name: string, keys: string[]): string
    isDown(action: string): boolean
    wasPressed(action: string): boolean
    on(action: string, fn: () => void): Dispose
    consumeWheel(): number
  }

  commands: {
    register(cmd: Omit<CommandDef, 'id'> & { id?: string }): void
  }

  render: {
    readonly three: typeof THREE
    readonly scene: THREE.Scene
    readonly camera: IsoCamera
    /** Add an object to the scene; removed (and disposed if possible) when the plugin unloads. */
    add<T extends THREE.Object3D>(object: T): T
  }

  /** The voxel island. Coordinates are block units; a block occupies [x, x+1). */
  world: {
    readonly sizeX: number
    readonly sizeZ: number
    readonly height: number
    /** Id returned for empty cells and used to remove blocks. */
    readonly AIR: string
    getBlock(x: number, y: number, z: number): string
    /** Edits go through the `world:beforeSetBlock` hook and emit `world:blockChanged`. */
    setBlock(x: number, y: number, z: number, id: string): boolean
    isSolid(x: number, y: number, z: number): boolean
    /** Y of the cell above the highest solid block in a column — where things stand. */
    surfaceY(x: number, z: number): number
    regenerate(seed?: number): Promise<void>
    /** Debounced regenerate (use from config sliders). */
    regenerateSoon(): void
    /** Low-level storage for bulk edits (no hooks/events). Call `voxels.markAllDirty()` after. */
    readonly voxels: VoxelWorld
  }

  textures: {
    /** Add a procedural texture pattern usable from `textures.json5` (`pattern: 'name'`). */
    pattern(name: string, fn: PatternFn): void
  }

  /** Register any extra cleanup. */
  onDispose(fn: Dispose): void
}
