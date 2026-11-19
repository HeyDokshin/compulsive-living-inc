import type { ZodType } from 'zod'
import type * as THREE from 'three'
import type { World } from 'miniplex'
import type { RegistryEntry, RegistryView } from '../registry/Registry'
import type { SystemDef } from '../loop/Scheduler'
import type { Components, Entity, GameEvents, GameHooks, Registries, CommandDef, Services } from '../types'
import type { ComponentType } from 'preact'
import type { ReadonlySignal } from '@preact/signals'
import type { UiSlot, WindowDef } from '../ui/UiHost'
import type { InteractionContext, InteractionDef } from '../interact/Interactions'
import type { SaverDef } from '../save/SaveService'
import type { PlayOptions } from '../audio/Audio'
import type { BurstOptions } from '../fx/Particles'
import type { VoxelHit } from '../world/pick'
import type { Dispose } from '../util/disposables'
import type { Logger } from '../util/log'
import type { IsoCamera } from '../render/IsoCamera'
import type { EngineConfig } from '../engineConfig'
import type { PlainObject } from '../util/objects'
import type { VoxelWorld } from '../world/VoxelWorld'
import type { PatternFn } from '../render/textures'
import type { StyleOptions } from '../render/style'
import type { SurfaceRect } from '../render/Renderer'

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
    /** Left stick of the first gamepad (x right, y down), deadzone applied. Live object. */
    readonly stick: { readonly x: number; readonly y: number }
    /** Mouse over the canvas: client pixels, `inside`, `movedAt` (performance.now()). Live object. */
    readonly pointer: { readonly x: number; readonly y: number; readonly inside: boolean; readonly movedAt: number }
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
    /** Give a custom material the game's look: world curvature, optional sway (plants) or flowing UVs. */
    stylize<T extends THREE.Material>(material: T, opts?: StyleOptions): T
    /** A voxel model from the `models` registry as a three.js object (appears when loaded). Not added to the scene. */
    voxelModel(id: string, opts?: { scale?: number; palette?: Record<string, string> }): THREE.Object3D
    /** Camera smoothly follows this entity (null = free camera). */
    follow(entity: Entity | null): void
    /**
     * Flat surfaces textured like a block's top; follows atlas changes. Rects are [x0, z0, x1, z1]
     * or [x0, z0, x1, z1, cellSize] — split big areas into cells so world curvature bends them.
     * Added to the scene and removed on unload.
     */
    blockSurface(blockId: string, rects: SurfaceRect[], y: number, opts?: { transparent?: boolean }): THREE.Mesh
  }

  /** The voxel island. Coordinates are block units; a block occupies [x, x+1). */
  world: {
    readonly sizeX: number
    readonly sizeZ: number
    readonly height: number
    /** Id returned for empty cells and used to remove blocks. */
    readonly AIR: string
    /** Seed of the current world (for deterministic placement). */
    readonly seed: number
    /** The voxel under a screen point (client pixels), e.g. the mouse — curvature-corrected. */
    pick(clientX: number, clientY: number): VoxelHit | null
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

  /** Sounds from the `sounds` registry (synthesized or files). `at` makes it quieter far from the camera. */
  audio: {
    play(id: string, opts?: PlayOptions): void
  }

  /** Particle bursts from the `particles` registry. */
  fx: {
    burst(id: string, at: { x: number; y: number; z: number }, opts?: BurstOptions): void
  }

  /** Preact UI: HUD slots, windows, toasts, item icons. */
  ui: {
    /** Put a component on screen. `order` sorts within the slot. */
    slot(slot: UiSlot, component: ComponentType, opts?: { order?: number }): void
    /** Register a window (opened with `open(id)` / `toggle(id)`; Esc closes). */
    window(def: WindowDef): void
    open(id: string): void
    close(): void
    toggle(id: string): void
    toast(text: string, opts?: { icon?: string; ms?: number }): void
    /** True while a modal window is open — pause gameplay input. */
    readonly modalOpen: ReadonlySignal<boolean>
    /** Icon (data URL) of an item, drawn from its model. */
    itemIcon(id: string): Promise<string>
  }

  /** The interaction matrix (definitions live in `api.registry('interactions')`). */
  interactions: {
    /** Context for the column (x, z) as seen by `actor`. */
    at(actor: Entity, x: number, z: number): InteractionContext
    find(ctx: InteractionContext): InteractionDef | null
    perform(ctx: InteractionContext): InteractionDef | null
    label(def: InteractionDef, ctx: InteractionContext): string
    /** Item the actor holds (answered by the inventory plugin through the `interaction:held` hook). */
    held(actor: Entity): string | null
  }

  /** Put this plugin's own state into saves (entities and voxels are saved by the engine). */
  save: {
    /**
     * `save()` returns plain data; `load(data)` gets it back before `start()` runs.
     * Bump `version` when the data shape changes and upgrade old data in `migrate(data, fromVersion)`.
     */
    register<T>(def: SaverDef<T>, name?: string): void
    /** True when this session was restored from a save (skip first-time setup in `start`). */
    readonly loaded: boolean
    saveNow(): Promise<void>
  }

  /** APIs that plugins offer each other. Add the provider to `dependsOn`. */
  services: {
    provide<K extends keyof Services & string>(name: K, impl: Services[K]): void
    get<K extends keyof Services & string>(name: K): Services[K]
    has(name: string): boolean
  }

  /** Register any extra cleanup. */
  onDispose(fn: Dispose): void
}
