import type { ZodType } from 'zod'
import type * as THREE from 'three'
import type { World } from 'miniplex'
import type { RegistryEntry, RegistryView } from '../registry/Registry'
import type { SystemDef } from '../loop/Scheduler'
import type { Components, Entity, GameEvents, GameHooks, Registries, CommandDef, Services } from '../types'
import type { ComponentType } from 'preact'
import type { ReadonlySignal, Signal } from '@preact/signals'
import type { UiSlot, WindowDef } from '../ui/UiHost'
import type { InteractionContext, InteractionDef } from '../interact/Interactions'
import type { SaverDef } from '../save/SaveService'
import type { LoopHandle, LoopOptions, NoteOptions, PlayOptions } from '../audio/Audio'
import type { BurstOptions } from '../fx/Particles'
import type { VoxelHit } from '../world/pick'
import type { GameDate, Season } from '../time/calendar'
import type { Dispose } from '../util/disposables'
import type { Logger } from '../util/log'
import type { IsoCamera } from '../render/IsoCamera'
import type { EngineConfig } from '../engineConfig'
import type { ModInfo } from '../mods/ModManager'
import type { FaceSlot } from '../models/ModelLibrary'
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
    /** Declare an action with default keys (`KeyboardEvent.code`, `Pad0`, `Mouse0`). With a `label` the player can rebind it in the settings. Returns the namespaced id. */
    action(name: string, keys: string[], label?: string): string
    /** Text of the key cap for an action, following the player's bindings and device (use in components). */
    keyLabel(action: string): string
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
    /** A rig from the `rigs` registry as a three.js object; its parts are child groups named after them
     * (`obj.getObjectByName('wingL')`) — rotate those to animate. Not added to the scene. */
    rigModel(id: string, opts?: { scale?: number; palette?: Record<string, string>; parts?: Record<string, string> }): THREE.Object3D
    /** Size (voxels), origin and scale of a voxel model — to hold, lay down or attach it precisely. */
    modelInfo(id: string): Promise<{ size: [number, number, number]; pivot: [number, number, number]; scale: number } | null>
    /** How hard plants sway (1 = a light breeze). */
    setWind(strength: number): void
    /** Shake the camera a little (amplitude in blocks, fading out over `seconds`). Respects the player's setting. */
    shake(amplitude: number, seconds: number): void
    /** Smoothly zoom the camera (clamped to the configured range). */
    setZoom(zoom: number): void
    /** Give an entity a model or change it (adds the component properly so it gets drawn, rebuilds the view). */
    setModel(entity: Entity, model: NonNullable<Entity['model']>): void
    /** Rebuild an entity's 3D view after changing its `model` (e.g. recolored clothes, another rig). */
    refreshView(entity: Entity): void
    /** Every drawn face of round rigs in the scene (heads whose model has a `face`) — to paint expressions. */
    eachFace(fn: (slot: FaceSlot) => void): void
    /** Screen pixels per block at the current zoom (detail decisions: texture sizes, fur). */
    readonly pixelsPerBlock: number
    /** Camera smoothly follows this entity (null = free camera). */
    follow(entity: Entity | null): void
    /**
     * Flat surfaces textured like a block's top; follows atlas changes. Rects are [x0, z0, x1, z1]
     * or [x0, z0, x1, z1, cellSize] — split big areas into cells so world curvature bends them.
     * Added to the scene and removed on unload.
     */
    blockSurface(blockId: string, rects: SurfaceRect[], y: number, opts?: { transparent?: boolean; cull?: boolean }): THREE.Mesh
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
    /** Y a walker stands at on the lowest land (level 1); the sea surface is level with it. Buildings go here. */
    readonly ground: number
    /** Levels one can stand on from the ground up (level 1 = `ground`). Natural land is at most one block higher. */
    readonly levels: number
    /** Y one stands at on the top level, which only holds things put on top: blocks go no higher than `topY - 1`. */
    readonly topY: number
    /** Y of the sea surface: level with `ground`, except on islands made before 0.16 (one block lower). */
    readonly sea: number
    /** The walking-blocker entity covering a cell (tree, rock, building), if any. */
    blockerAt(x: number, z: number): Entity | undefined
    /** Call after moving an entity that has a `blocker`. */
    updateBlocker(entity: Entity): void
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
    /** One synthesized note (default bus: music). Generative music schedules these ahead with `at`. */
    note(n: NoteOptions): void
    /** A continuous sound (surf, wind…), silent until `setGain`. Null until the player first clicks/presses a key. */
    loop(o?: LoopOptions): LoopHandle | null
    /** Audio is unlocked (browsers require a first user gesture). */
    readonly ready: boolean
    /** Audio clock in seconds. */
    readonly time: number
  }

  /** Particle bursts from the `particles` registry. */
  fx: {
    burst(id: string, at: { x: number; y: number; z: number }, opts?: BurstOptions): void
  }

  /** The game clock. Listen to `time:hour`, `time:day` (also replayed for missed days), `time:season`. */
  time: {
    now(): GameDate
    readonly hour: number
    readonly dayIndex: number
    readonly season: Season
    /** Move the clock (debug / time travel), e.g. `shift(3 * 86_400_000)`. */
    shift(ms: number): void
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
    /** Cut-scene mode: set true and the HUD fades out (windows and the 'screen' slot stay). */
    readonly cinema: Signal<boolean>
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
  /** Rooms built in reserved corners of the world (one 16 × 16 chunk each, always open sea). */
  interiors: {
    /** The area of a room: first cell and size. Build its voxels there with `world.setBlock` when the
     * player goes in (`interior:changed`); on the way out the engine turns it back into sea. */
    area(id: string): { x: number; z: number; w: number; d: number }
    /** Room the player is in, or null outside. */
    readonly current: string | null
    /** The room a world point belongs to (furniture placed inside), or null. */
    roomAt(x: number, z: number): string | null
    /** Put the actor inside at `at`; remembers where it stood to come back. Only that room is drawn. */
    enter(id: string, actor: Entity, at: { x: number; y: number; z: number; rotY: number }): void
    /** Back outside where the actor entered. */
    exit(actor: Entity): void
  }
  /** Settings a plugin adds (registry `options`), as the player chose them on this device. */
  options: {
    /** Current value (read in a component or `effect`, it stays current). */
    get(id: string): string | boolean
  }

  /** The island being played. */
  session: {
    /** The island's name. */
    readonly name: string
    /** The player's name ('' = not given). */
    readonly player: string
    rename(names: { name?: string; player?: string }): void
  }
  save: {
    /**
     * `save()` returns plain data; `load(data)` gets it back before `start()` runs.
     * Bump `version` when the data shape changes and upgrade old data in `migrate(data, fromVersion)`.
     */
    register<T>(def: SaverDef<T>, name?: string): void
    /** True when this session was restored from a save (skip first-time setup in `start`). */
    readonly loaded: boolean
    /**
     * True when the loaded save had data for this plugin. False on a new island — and on an older
     * save made before the plugin existed: that's the moment to set the island up for it.
     */
    readonly hasData: boolean
    saveNow(): Promise<void>
  }

  /** Content as data: for tools that show or edit any registry. */
  content: {
    /** Registries described by a schema, with how many entries they have. */
    registries(): Array<{ name: string; owner: string; size: number }>
    /** JSON Schema of a registry's entries (null: it has none). */
    schema(registry: string): Record<string, unknown> | null
    ids(registry: string): string[]
    /** The entry with all changes applied. */
    get(registry: string, id: string): RegistryEntry | undefined
    /** The entry as it is without one mod's changes. */
    without(registry: string, id: string, modId: string): RegistryEntry | undefined
    /** Who registered it: 'content:<pack>' or a plugin id. */
    ownerOf(registry: string, id: string): string | undefined
    /** What is wrong with an entry (empty = fine). */
    check(registry: string, entry: RegistryEntry): string[]
  }

  /** Mods of the player. Only installed ones can be edited. */
  mods: {
    list(): ModInfo[]
    create(m: { id: string; name: string; author?: string; description?: string }): Promise<void>
    read(id: string, path: string): string | undefined
    /** Save a text file of a mod (null removes it); content takes effect at once. */
    write(id: string, path: string, text: string | null): Promise<void>
    /** The mod as a .zip. */
    exportZip(id: string): Promise<Uint8Array>
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
