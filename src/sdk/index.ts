/**
 * Public modding / plugin SDK. Plugins import ONLY from '@sdk'.
 *
 *   import { definePlugin, z } from '@sdk'
 *   export default definePlugin({ id: 'my_mod', setup(api) { ... } })
 *
 * Extend the shared type maps with module augmentation:
 *
 *   declare module '@sdk' {
 *     interface Components { spin: { speed: number } }
 *     interface GameEvents { 'my_mod:thing': { id: string } }
 *   }
 */
import type { PluginApi } from '../engine/plugins/PluginApi'
import type { PluginDefinition } from '../engine/plugins/PluginManager'

export { z } from 'zod'
export type { PluginApi } from '../engine/plugins/PluginApi'
export type { PluginMeta } from '../engine/plugins/PluginManager'
export type { RegistryEntry, RegistryView, RegistryChange } from '../engine/registry/Registry'
export type { SystemDef } from '../engine/loop/Scheduler'
export type { Dispose } from '../engine/util/disposables'
export type { FaceSlot } from '../engine/models/ModelLibrary'
export type {
  Components,
  Entity,
  Transform,
  ModelSpec,
  BlockDef,
  PrefabDef,
  CommandDef,
  CommandContext,
  Registries,
  GameEvents,
  GameHooks,
  Phase,
  TickPhase,
  TickContext,
  Services,
} from '../engine/types'
export type { ItemDef } from '../engine/items/defs'
export type { InteractionDef, InteractionContext } from '../engine/interact/Interactions'
export type { UiSlot, WindowDef } from '../engine/ui/UiHost'
export type { ModelDef, RigDef } from '../engine/models/defs'
export type { ModInfo } from '../engine/mods/ModManager'
export type { OptionDef } from '../engine/session/options'
export type { SaverDef } from '../engine/save/SaveService'
export type { SoundDef, SynthLayer } from '../engine/audio/defs'
export type { LoopHandle, NoteOptions } from '../engine/audio/Audio'
export type { ParticleDef } from '../engine/fx/defs'
export type { VoxelHit } from '../engine/world/pick'
export type { GameDate, Season } from '../engine/time/calendar'
export type { LightState } from '../engine/render/dayCycle'

// UI toolkit for plugins: Preact + signals + the game's components.
export { h, Fragment, type ComponentChildren, type ComponentType } from 'preact'
export { useState, useEffect, useMemo, useRef, useCallback } from 'preact/hooks'
export { signal, computed, effect, batch, useSignal, useComputed, type Signal, type ReadonlySignal } from '@preact/signals'
export * as ui from '../engine/ui/components'
export type { EngineConfig, WorldConfig } from '../engine/engineConfig'
export type { WorldGenStep, WorldGenContext } from '../engine/world/WorldGen'
export type { TextureDef, PatternFn, PatternContext } from '../engine/render/textures'
export type { StyleOptions } from '../engine/render/style'
export type { SurfaceRect } from '../engine/render/Renderer'

export type Plugin = PluginDefinition<PluginApi>

/** Identity helper that gives full typing to a plugin definition. */
export function definePlugin(def: Plugin): Plugin {
  return def
}

/** One syllable of a character's babble (call it from `ui.Dialogue`'s `onBlip`). */
export function voiceBlip(api: PluginApi, pitch: number): void {
  api.audio.note({ wave: 'triangle', freq: pitch * (0.85 + Math.random() * 0.35), duration: 0.045, gain: 0.05, attack: 0.004, bus: 'ui' })
}

// Pure helpers plugins share.
export { downloadFile } from '../engine/ui/files'
export { deepMerge } from '../engine/util/objects'
export { default as JSON5 } from 'json5'
export { SDK_VERSION } from '../engine/version'
export { findPath, lineWalkable, type Cell, type PathOptions } from '../engine/world/path'
