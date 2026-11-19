/**
 * Extensible type maps. Plugins extend them through module augmentation:
 *
 *   declare module '@sdk' {
 *     interface Components { spin: { speed: number } }
 *     interface GameEvents { 'fishing:caught': { species: string } }
 *     interface Registries { 'fishing:baits': BaitDef }
 *   }
 */
import { z } from 'zod'
import type { Object3D } from 'three'
import type { RegistryEntry } from './registry/Registry'
import type { TextureDef } from './render/textures'
import type { WorldGenStep } from './world/WorldGen'
import type { ModelDef, RigDef } from './models/defs'
import type { ItemDef } from './items/defs'
import type { SoundDef } from './audio/defs'
import type { ParticleDef } from './fx/defs'
import type { InteractionContext, InteractionDef } from './interact/Interactions'

// ---------- components ----------

export const TransformSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  rotY: z.number().default(0),
})
export type Transform = z.infer<typeof TransformSchema>

export const ModelSchema = z.object({
  /** box: colored cuboid · voxel: a model from the `models` registry · rig: an animatable `rigs` entry. */
  shape: z.enum(['box', 'voxel', 'rig']).default('box'),
  /** Model or rig id for `voxel` / `rig`. */
  ref: z.string().optional(),
  size: z.tuple([z.number(), z.number(), z.number()]).default([1, 1, 1]),
  color: z.string().default('#cccccc'),
  /** Vertical offset so a model can stand on the ground (y = bottom). Box only. */
  anchor: z.enum(['bottom', 'center']).default('bottom'),
  /** World units per voxel; overrides the model/rig default. */
  scale: z.number().positive().optional(),
  /** Recolor palette characters of layer-drawn models, e.g. `{ t: '#ffb3c7' }` for a pink shirt. */
  palette: z.record(z.string(), z.string()).optional(),
})
export type ModelSpec = z.infer<typeof ModelSchema>

export const SilhouetteSchema = z.object({ color: z.string().default('#ffffff'), opacity: z.number().min(0).max(1).default(0.45) })
export const BlobShadowSchema = z.object({ radius: z.number().positive().default(0.4), opacity: z.number().min(0).max(1).default(0.35) })

export interface Components {
  /** Unique, stable per save (assigned at spawn). */
  uid?: number
  /** Prefab id the entity was spawned from. */
  prefab?: string
  name?: string
  transform?: Transform
  model?: ModelSpec
  /** Runtime-only three.js object created by the renderer. Never saved. */
  view?: Object3D
  /** Show a soft silhouette where the entity is hidden behind terrain. */
  silhouette?: { color: string; opacity: number }
  /** Soft round shadow on the ground under the entity. */
  blobShadow?: { radius: number; opacity: number }
}

export type Entity = Components

// ---------- registries ----------

export const BlockSchema = z.looseObject({
  id: z.string(),
  tags: z.array(z.string()).optional(),
  name: z.string().optional(),
  /** Fallback color: used for the auto texture when `textures` is missing, and on maps/particles. */
  color: z.string().default('#ff00ff'),
  /** Blocks movement. */
  solid: z.boolean().default(true),
  /** Rendered in the see-through pass (water, glass). */
  transparent: z.boolean().default(false),
  /** Liquid surface: drawn slightly below the block top and animated (needs `transparent`). */
  liquid: z.boolean().default(false),
  /** Top face gets soft sunny/shady color patches (engine `render.tint`). */
  tint: z.boolean().default(false),
  /** Sounds of this block (`sounds` registry ids): footsteps on it, digging it. */
  sounds: z.object({ step: z.string().optional(), dig: z.string().optional() }).optional(),
  /** Texture ids per face; `all`, then `top` / `bottom` / `side`, then `east|west|south|north`. */
  textures: z
    .object({
      all: z.string().optional(),
      top: z.string().optional(),
      bottom: z.string().optional(),
      side: z.string().optional(),
      east: z.string().optional(),
      west: z.string().optional(),
      south: z.string().optional(),
      north: z.string().optional(),
    })
    .optional(),
})
export type BlockDef = z.infer<typeof BlockSchema>

export const PrefabSchema = z.looseObject({
  id: z.string(),
  tags: z.array(z.string()).optional(),
  /** Inherit components from another prefab. */
  extends: z.string().optional(),
  components: z.record(z.string(), z.unknown()).default({}),
})
export type PrefabDef = z.infer<typeof PrefabSchema>

export interface CommandContext {
  print(text: string): void
}
export interface CommandDef extends RegistryEntry {
  /** Short name typed in the console (`spawn`); the full id (`debug:spawn`) also works. */
  name: string
  description: string
  usage?: string
  run(args: string[], ctx: CommandContext): void | string | Promise<void | string>
}

export interface Registries {
  sounds: SoundDef
  particles: ParticleDef
  items: ItemDef
  interactions: InteractionDef
  models: ModelDef
  rigs: RigDef
  blocks: BlockDef
  textures: TextureDef
  prefabs: PrefabDef
  commands: CommandDef
  worldgen: WorldGenStep
}

// ---------- events & hooks ----------

export interface GameEvents {
  'engine:started': {}
  'plugin:loaded': { id: string }
  'plugin:unloaded': { id: string }
  'content:loaded': { packs: string[] }
  'config:changed': { id: string }
  'entity:spawned': { entity: Entity }
  'entity:despawned': { entity: Entity }
  'world:generated': { seed: number; ms: number }
  'world:blockChanged': { x: number; y: number; z: number; from: string; to: string }
  'interaction:performed': { id: string; ctx: InteractionContext }
  /** A new game or a loaded save is fully set up (plugins started). */
  'session:started': { loaded: boolean; slot: string }
  'save:saved': { slot: string }
  'save:loaded': { slot: string }
}

/**
 * Services plugins offer each other (`api.services.provide` / `get`). Augment to type them:
 *   declare module '@sdk' { interface Services { 'items:inventory': InventoryService } }
 */
export interface Services {}

export interface GameHooks {
  /** Change components before an entity is created. */
  'entity:beforeSpawn': { value: Components; ctx: { prefab?: string } }
  /** Override which interaction happens (or return null to block it). */
  'interaction:resolve': { value: InteractionDef | null; ctx: InteractionContext }
  /**
   * Is the cell (x, y, z) a wall for walking, even though no solid block is there?
   * E.g. a dug hole blocks its column so characters walk around it.
   */
  'movement:blocked': { value: boolean; ctx: { x: number; y: number; z: number } }
  /** Which item an actor holds (the inventory plugin answers this). */
  'interaction:held': { value: string | null; ctx: { actor: Entity } }
  /** Change or cancel a block edit made through `api.world.setBlock`. */
  'world:beforeSetBlock': { value: { id: string; cancelled: boolean }; ctx: { x: number; y: number; z: number; from: string } }
}

// ---------- systems ----------

export type TickPhase = 'input' | 'preUpdate' | 'update' | 'postUpdate'
export type Phase = TickPhase | 'render'

export interface TickContext {
  /** Fixed step in seconds (simulation) or frame delta (render). */
  dt: number
  tick: number
  /** Interpolation factor between the previous and current tick (render phase only). */
  alpha: number
  /** Seconds of simulated time since start. */
  time: number
}
