import type { Registry, RegistryEntry } from '../registry/Registry'
import type { Hooks } from '../events/Hooks'
import type { EventBus } from '../events/EventBus'
import type { BlockDef, Entity, GameEvents, GameHooks } from '../types'
import type { ItemDef } from '../items/defs'

/** Everything an interaction can look at: who acts, with what, on which cell. */
export interface InteractionContext {
  actor: Entity
  /** Item id held by the actor (null = empty hands). */
  held: string | null
  /** Target cell; `y` is the top block of the column (or the block in front for walls). */
  x: number
  y: number
  z: number
  /** Block at (x, y, z) — 'air' if none. */
  block: string
  /** Entities standing in the target cell. */
  entities: Entity[]
  /** The entity that matched `entity` in the definition, if any. */
  target?: Entity
  /** Which button: the main action (E) or the second one (F) — default primary. */
  button?: 'primary' | 'secondary'
}

/**
 * One cell of the interaction matrix: "with this tool, on this target → do this".
 * Matching: `tool` (item id / #tag / null = empty hands / omitted = anything) ×
 * `block` (id / #tag) × `entity` (component name the target entity must have) × `when`.
 * Highest `priority` wins.
 */
export interface InteractionDef extends RegistryEntry {
  /** Shown in the hint: "Копать", "Подобрать". May depend on the context. */
  label: string | ((ctx: InteractionContext) => string)
  priority?: number
  /** 'secondary' = the second action key (F): rotate, take, put away… Default 'primary'. */
  button?: 'primary' | 'secondary'
  tool?: string | null
  block?: string
  entity?: string
  when?(ctx: InteractionContext): boolean
  /** Do it. Return false if nothing happened (the actor won't play the use animation). */
  run(ctx: InteractionContext): void | boolean
  /** Animation hint for the actor: 'swing' (tools), 'pickup', 'none'. Default 'swing'. */
  anim?: 'swing' | 'pickup' | 'none'
  /** Sound played at the target when it happens (`sounds` registry). */
  sound?: string
  /** Particle burst at the target (`particles` registry); `particleColor: 'block'` tints it like the target block. */
  particles?: string
  particleColor?: 'block'
}

export class Interactions {
  /** Definitions by priority (highest first), rebuilt when the registry changes. */
  private sorted: InteractionDef[] | null = null

  constructor(
    private defs: Registry<InteractionDef>,
    private items: Registry<ItemDef>,
    private blocks: Registry<BlockDef>,
    private hooks: Hooks<GameHooks>,
    private events: EventBus<GameEvents>,
  ) {
    defs.onChange(() => (this.sorted = null))
  }

  /** The interaction that would happen (for hints), or null. Runs every frame for the cursor. */
  find(ctx: InteractionContext): InteractionDef | null {
    const candidates = (this.sorted ??= this.defs.all().sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)))
    let found: InteractionDef | null = null
    const button = ctx.button ?? 'primary'
    for (const def of candidates) {
      if ((def.button ?? 'primary') !== button) continue
      if (!this.matchTool(def.tool, ctx.held)) continue
      if (def.block && !this.matchBlock(def.block, ctx.block)) continue
      let target: Entity | undefined
      if (def.entity) {
        target = ctx.entities.find((e) => (e as Record<string, unknown>)[def.entity!] !== undefined)
        if (!target) continue
      }
      const c = target ? { ...ctx, target } : ctx
      try {
        if (def.when && !def.when(c)) continue
      } catch (e) {
        console.error(`[interactions] when() of "${def.id}" failed`, e)
        continue
      }
      found = def
      if (target) ctx.target = target
      break
    }
    return this.hooks.run('interaction:resolve', found, ctx)
  }

  label(def: InteractionDef, ctx: InteractionContext): string {
    return typeof def.label === 'function' ? def.label(ctx) : def.label
  }

  /** Find and run. Returns the interaction that ran (and did something), or null. */
  perform(ctx: InteractionContext): InteractionDef | null {
    const def = this.find(ctx)
    if (!def) return null
    let ok: void | boolean
    try {
      ok = def.run(ctx)
    } catch (e) {
      console.error(`[interactions] "${def.id}" failed`, e)
      return null
    }
    if (ok === false) return null
    this.events.emit('interaction:performed', { id: def.id, ctx })
    return def
  }

  private matchTool(tool: string | null | undefined, held: string | null): boolean {
    if (tool === undefined) return true
    if (tool === null) return held === null
    if (held === null) return false
    return tool.startsWith('#') ? this.items.isTagged(held, tool) : held === tool
  }

  private matchBlock(ref: string, block: string): boolean {
    return ref.startsWith('#') ? this.blocks.isTagged(block, ref) : ref === block
  }
}
