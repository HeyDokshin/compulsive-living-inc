/**
 * Decor: things you put anywhere on the island — benches, fences, lamps, a bonfire… Pieces and their
 * color variants are data (content/decor/decor.pieces.json5); every variant is an item
 * `decor:<piece>_<variant>`. Hold one and press the action key on free ground to place it (it faces
 * you); take it back with the action key, turn it with the second one (F). Lamps and bonfires glow
 * after dark. A plugin can keep a piece from being taken (a chest with things in it) via the
 * `decor:canTake` hook.
 * Other plugins find pieces through the `decor:pieces` service (crafting repaints them).
 */
import { definePlugin, z, type Entity, type PluginApi, type RegistryEntry } from '@sdk'
import { fits, topmost, type Layer, type Placed } from './layers'

export interface Variant {
  id: string
  name: string
  palette: Record<string, string>
}

export interface PieceDef extends RegistryEntry {
  name: string
  description?: string
  model: string
  price: number
  stack: number
  blocker: boolean
  /** floor (furniture) · rug · top (on a table) · wall (hangs on a wall, indoors). */
  layer: Layer
  /** Tables: height of the top other pieces stand on (blocks). */
  surface: number
  /** Only inside rooms (wall pieces). */
  indoor: boolean
  glow?: { color: string; size: number; y: number; flicker: boolean }
  variants: Variant[]
}

export interface DecorPieces {
  get(pieceId: string): PieceDef | undefined
  all(): PieceDef[]
  itemId(pieceId: string, variantId: string): string
  /** Which piece and variant an item is (null for other items). */
  of(itemId: string): { piece: PieceDef; variant: Variant } | null
  /** Ground height if a piece can stand on this cell (free, solid ground), else null. */
  freeCell(x: number, z: number): number | null
  /** Put a piece on the island (no item needed — for starting furniture). */
  place(pieceId: string, variantId: string, x: number, z: number, rotY?: number): Entity | null
  /** Put a placed piece back into the actor's pockets (false: pockets full or not allowed). */
  take(actor: Entity, piece: Entity): boolean
}

declare module '@sdk' {
  interface Components {
    decor?: { piece: string; variant: string }
  }
  interface Registries {
    'decor:pieces': PieceDef
  }
  interface Services {
    'decor:pieces': DecorPieces
  }
  interface GameHooks {
    /** May this placed piece be taken back? (e.g. not a chest with things in it) */
    'decor:canTake': { value: boolean; ctx: { entity: Entity; actor: Entity } }
  }
}

const PieceSchema = z.looseObject({
  id: z.string(),
  tags: z.array(z.string()).optional(),
  name: z.string(),
  description: z.string().optional(),
  model: z.string(),
  price: z.number().int().min(0).default(100),
  stack: z.number().int().min(1).default(1),
  blocker: z.boolean().default(true),
  layer: z.enum(['floor', 'rug', 'top', 'wall']).default('floor'),
  surface: z.number().min(0).max(2).default(0),
  indoor: z.boolean().default(false),
  glow: z.object({ color: z.string(), size: z.number().default(2), y: z.number().default(1), flicker: z.boolean().default(false) }).optional(),
  variants: z.array(z.object({ id: z.string(), name: z.string().default(''), palette: z.record(z.string(), z.string()).default({}) })).min(1),
})

const Config = z.object({
  /** Brightness of lamp and bonfire light at night. */
  glow: z.number().min(0).max(2).default(1).meta({ step: 0.05 }),
  /** Ground blocks things can stand on (tags). */
  groundTags: z.array(z.string()).default(['#core:ground', '#house:floors']),
  /** Rooms where pieces may be placed (others, like the museum hall, are not yours to furnish). */
  rooms: z.array(z.string()).default(['house:home']),
  /** Lamps and fires glow at least this much inside rooms, day or night. */
  indoorGlow: z.number().min(0).max(1).default(0.55).meta({ label: 'indoor glow', step: 0.05 }),
  /** Wall pieces hang this high above the floor (blocks). */
  wallHeight: z.number().min(0).max(4).default(1.1).meta({ label: 'wall height', step: 0.05 }),
})

export const variantItemId = (pieceId: string, variantId: string) => `${pieceId}_${variantId}`

export default definePlugin({
  id: 'decor',
  version: '0.1.0',
  description: 'Поделки: скамейки, заборы, фонари, костёр — ставить где угодно, разные цвета',
  dependsOn: ['items'],

  setup(api) {
    const cfg = api.config.define(Config)
    const pieces = api.createRegistry<PieceDef>('decor:pieces', PieceSchema as never)
    const byItem = new Map<string, { piece: PieceDef; variant: Variant }>()
    api.components.define('decor', z.object({ piece: z.string(), variant: z.string() }))

    // Items: one per piece × variant.
    const registerItems = () => {
      const items = api.registry('items')
      byItem.clear()
      for (const piece of pieces.all()) {
        for (const v of piece.variants) {
          const id = variantItemId(piece.id, v.id)
          byItem.set(id, { piece, variant: v })
          if (items.has(id)) continue
          items.register({
            id,
            name: v.name && piece.variants.length > 1 ? `${piece.name} (${v.name})` : piece.name,
            description: piece.description,
            stack: piece.stack,
            model: piece.model,
            palette: v.palette,
            price: piece.price,
            tags: ['decor:pieces'],
            held: { tilt: 0, scale: 0.7 },
            ground: { lie: false },
          })
        }
      }
    }
    api.events.on('content:loaded', registerItems)
    registerItems()


    const look = (e: Entity) => {
      const d = e.decor!
      const piece = pieces.get(d.piece)
      const v = piece?.variants.find((x) => x.id === d.variant) ?? piece?.variants[0]
      if (!piece || !v) return
      api.render.setModel(e, { shape: 'voxel', ref: piece.model, palette: v.palette, size: [1, 1, 1], color: '#ccc', anchor: 'bottom' })
      e.name = api.registry('items').get(variantItemId(piece.id, v.id))?.name ?? piece.name
    }

    // --- placing and taking back -------------------------------------------------------------
    const blocks = api.registry('blocks')
    const inventory = () => api.services.get('items:inventory')
    const decorQuery = api.entities.world.with('decor', 'transform')
    const layerOf = (e: Entity): Layer => pieces.get(e.decor!.piece)?.layer ?? 'floor'
    /** Decor pieces in a cell, as layer records. */
    const placedAt = (x: number, z: number): Array<Placed<Entity>> => {
      const out: Array<Placed<Entity>> = []
      for (const e of decorQuery) {
        if (Math.floor(e.transform.x) !== x || Math.floor(e.transform.z) !== z) continue
        out.push({ layer: layerOf(e), surface: pieces.get(e.decor.piece)?.surface ?? 0, y: e.transform.y, ref: e })
      }
      return out
    }
    const ground = (x: number, z: number): number | null => {
      const y = api.world.surfaceY(x, z)
      if (y <= 0 || !cfg.groundTags.some((t) => blocks.isTagged(api.world.getBlock(x, y - 1, z), t))) return null
      if (api.world.getBlock(x, y, z) !== api.world.AIR || api.world.getBlock(x, y + 1, z) !== api.world.AIR) return null
      return y
    }
    /** Ground height of a cell free for furniture (rugs don't count), or null. */
    const freeCell = (x: number, z: number): number | null => {
      const y = ground(x, z)
      if (y === null || api.world.blockerAt(x, z) || api.hooks.run('movement:blocked', false, { x, y, z })) return null
      for (const e of api.entities.world.with('transform')) {
        if (Math.floor(e.transform.x) !== x || Math.floor(e.transform.z) !== z) continue
        if (!e.decor || layerOf(e) !== 'rug') return null
      }
      return y
    }
    /** Where a piece would go in a cell (base height), or null. `actorY` = the floor the actor stands on. */
    const spotFor = (piece: PieceDef, x: number, z: number, actorY: number): number | null => {
      const room = api.interiors.current
      if (room ? !cfg.rooms.includes(room) : piece.indoor) return null
      const here = placedAt(x, z)
      const rule = fits(piece.layer, here)
      if (!rule.ok) return null
      switch (piece.layer) {
        case 'floor':
          return freeCell(x, z)
        case 'rug': {
          // under furniture is fine; not under a tree or a rock
          const y = ground(x, z)
          const b = api.world.blockerAt(x, z)
          return y !== null && (!b || !!b.decor) ? y : null
        }
        case 'top':
          return rule.on ? rule.on.y + rule.on.surface : null
        case 'wall': {
          // a wall in front: solid where a picture would hang
          const y = Math.round(actorY)
          return api.world.isSolid(x, y, z) && api.world.isSolid(x, y + 1, z) ? y + cfg.wallHeight : null
        }
      }
    }
    const spawnPiece = (piece: PieceDef, variant: Variant, x: number, y: number, z: number, rotY: number) => {
      const e = api.entities.spawn({
        transform: { x: x + 0.5, y, z: z + 0.5, rotY },
        decor: { piece: piece.id, variant: variant.id },
        ...(piece.layer === 'floor' ? { blobShadow: { radius: 0.42, opacity: 0.18 } } : {}),
        // wall pieces are found through the blocker index (the wall is the cell's top, not them)
        ...((piece.blocker && piece.layer === 'floor') || piece.layer === 'wall' ? { blocker: { w: 1, d: 1, h: piece.layer === 'wall' ? 1 : 2 } } : {}),
      })
      look(e)
      return e
    }
    const take = (actor: Entity, e: Entity) => {
      if (!e.decor || !api.hooks.run('decor:canTake', true, { entity: e, actor })) return false
      // a table with something on it: take that first
      if (layerOf(e) === 'floor' && placedAt(Math.floor(e.transform!.x), Math.floor(e.transform!.z)).some((p) => p.layer === 'top')) {
        api.ui.toast('Сначала заберите то, что стоит сверху.')
        return false
      }
      const id = variantItemId(e.decor.piece, e.decor.variant)
      if (inventory().add(actor, id, 1) > 0) return false // pockets full: the service says so
      api.entities.despawn(e)
      return true
    }
    api.services.provide('decor:pieces', {
      take,
      get: (id) => pieces.get(id) ?? undefined,
      all: () => pieces.all(),
      itemId: variantItemId,
      of: (itemId) => byItem.get(itemId) ?? null,
      freeCell,
      place: (pieceId, variantId, x, z, rotY = 0) => {
        const piece = pieces.get(pieceId)
        const variant = piece?.variants.find((v) => v.id === variantId) ?? piece?.variants[0]
        const y = freeCell(x, z)
        return piece && variant && y !== null ? spawnPiece(piece, variant, x, y, z, rotY) : null
      },
    })

    /** The piece the action key reaches in the target cell (what's on top of the stack). */
    const reach = (ctx: { x: number; z: number; entities: Entity[] }) => {
      const here = placedAt(ctx.x, ctx.z)
      for (const e of ctx.entities) if (e.decor && !here.some((p) => p.ref === e)) here.push({ layer: layerOf(e), surface: 0, y: e.transform?.y ?? 0, ref: e })
      return topmost(here)?.ref
    }
    const interactions = api.registry('interactions')
    interactions.register({
      id: 'decor:place',
      tool: '#decor:pieces',
      priority: 30,
      label: (ctx) => `Поставить: ${api.registry('items').get(ctx.held ?? '')?.name ?? ''}`,
      sound: 'core:drop',
      anim: 'pickup',
      when: (ctx) => {
        const what = ctx.held ? byItem.get(ctx.held) : undefined
        return !!what && spotFor(what.piece, ctx.x, ctx.z, ctx.actor.transform!.y) !== null
      },
      run: (ctx) => {
        const what = byItem.get(ctx.held!)
        const y = what ? spotFor(what.piece, ctx.x, ctx.z, ctx.actor.transform!.y) : null
        if (!what || y === null || inventory().remove(ctx.actor, ctx.held!, 1) < 1) return false
        const t = ctx.actor.transform!
        // face the actor, snapped to the grid
        const facing = Math.round(Math.atan2(t.x - (ctx.x + 0.5), t.z - (ctx.z + 0.5)) / (Math.PI / 2)) * (Math.PI / 2)
        spawnPiece(what.piece, what.variant, ctx.x, y, ctx.z, facing)
        return true
      },
    })
    interactions.register({
      id: 'decor:take',
      entity: 'decor',
      priority: 12,
      label: 'Забрать',
      sound: 'core:pickup',
      anim: 'pickup',
      run: (ctx) => {
        const e = reach(ctx)
        return !!e && take(ctx.actor, e)
      },
    })
    interactions.register({
      id: 'decor:rotate',
      entity: 'decor',
      button: 'secondary',
      priority: 10,
      label: 'Повернуть',
      anim: 'none',
      sound: 'core:drop',
      run: (ctx) => {
        const t = reach(ctx)?.transform
        if (!t) return false
        t.rotY = Math.round(t.rotY / (Math.PI / 2) + 1) * (Math.PI / 2)
      },
    })
    // Views come back from saves without a model: rebuild them.
    api.events.on('session:started', () => {
      for (const e of api.entities.world.with('decor')) look(e)
    })

    // --- glow after dark -----------------------------------------------------------------------
    setupGlow(api, cfg, (id) => pieces.get(id) ?? undefined)

    api.commands.register({
      name: 'decor',
      description: 'Поделки: decor (список) · decor all (дать по одной каждого цвета)',
      usage: '[all]',
      run: ([what]) => {
        if (what === 'all') {
          const actor = [...api.entities.world.with('player', 'transform')][0]
          if (actor) for (const id of byItem.keys()) inventory().add(actor, id, 1, { quiet: true })
        }
        return pieces
          .all()
          .map((p) => `${p.id.padEnd(20)} ${p.name}: ${p.variants.map((v) => v.id).join(', ')}`)
          .join('\n')
      },
    })
  },
})

/** Soft halos over glowing pieces at night (sprites, pooled per entity). */
function setupGlow(api: PluginApi, cfg: { glow: number; indoorGlow: number }, piece: (id: string) => PieceDef | undefined) {
  const T = api.render.three
  const group = api.render.add(new T.Group())
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,0.9)')
  grad.addColorStop(0.3, 'rgba(255,255,255,0.35)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const tex = new T.CanvasTexture(c)
  const halos = new Map<Entity, InstanceType<typeof T.Sprite>>()
  api.onDispose(() => {
    tex.dispose()
    for (const s of halos.values()) s.material.dispose()
  })
  const night = () => {
    const h = api.time.hour
    return Math.min(1, Math.max(0, (Math.abs(h - 12.5) - 5.5) / 1.5))
  }
  let time = 0
  const decor = api.entities.world.with('decor', 'transform')
  api.systems.add({
    id: 'glow',
    phase: 'render',
    run: ({ dt }) => {
      time += dt
      const n = Math.max(night(), api.interiors.current ? cfg.indoorGlow : 0) * cfg.glow
      for (const [e, s] of halos) {
        if (!api.entities.world.has(e) || !e.decor) {
          s.removeFromParent()
          s.material.dispose()
          halos.delete(e)
        }
      }
      for (const e of decor) {
        const glow = piece(e.decor.piece)?.glow
        if (!glow) continue
        let s = halos.get(e)
        if (!s) {
          s = new T.Sprite(new T.SpriteMaterial({ map: tex, color: glow.color, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0 }))
          s.scale.setScalar(glow.size)
          group.add(s)
          halos.set(e, s)
        }
        const flicker = glow.flicker ? 0.8 + Math.sin(time * 11 + e.transform.x) * 0.1 + Math.sin(time * 17) * 0.1 : 1
        s.position.set(e.transform.x, e.transform.y + glow.y, e.transform.z)
        s.material.opacity = Math.min(1, n * flicker)
        s.visible = s.material.opacity > 0.01 && (e.view?.visible ?? true)
      }
    },
  })
}
