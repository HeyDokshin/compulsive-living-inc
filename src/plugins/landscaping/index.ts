/**
 * Landscaping: paths and terraforming.
 * - Path kits (content/landscaping/landscaping.paths.json5) pave a cell of grass, sand or soil; the
 *   shovel's second action (F) on a path lifts it and gives the kit back.
 * - The shovel's second action elsewhere shapes the land: a column standing higher than you is dug
 *   down, one level with you gets a block on top — within a couple of blocks of how the island was made.
 */
import { definePlugin, z, type RegistryEntry } from '@sdk'
import { terraformOp } from './terraform'

export interface PathDef extends RegistryEntry {
  name: string
  block: string
  price: number
}

declare module '@sdk' {
  interface Registries {
    'landscaping:paths': PathDef
  }
}

const Config = z.object({
  /** Blocks a path can replace. */
  pavable: z.array(z.string()).default(['core:grass', 'core:sand', 'core:dirt']),
  pathStack: z.number().int().min(1).max(99).default(30).meta({ label: 'path stack', step: 1 }),
  maxUp: z.number().int().min(0).max(8).default(2).meta({ label: 'raise up to', step: 1 }),
  maxDown: z.number().int().min(0).max(8).default(1).meta({ label: 'dig down to', step: 1 }),
  maxHeight: z.number().int().min(4).max(31).default(24).meta({ label: 'max height', step: 1 }),
  /** Never dig to this height or lower (water level). */
  minHeight: z.number().int().min(0).max(31).default(8).meta({ label: 'min height', step: 1 }),
  /** Raised ground: grass on top, soil under it. */
  top: z.string().default('core:grass'),
  under: z.string().default('core:dirt'),
})

export default definePlugin({
  id: 'landscaping',
  version: '0.1.0',
  description: 'Дорожки и терраформинг лопатой',
  dependsOn: ['items', 'tools'],

  setup(api) {
    const cfg = api.config.define(Config)
    const paths = api.createRegistry<PathDef>(
      'landscaping:paths',
      z.looseObject({ id: z.string(), name: z.string(), block: z.string(), price: z.number().int().min(0).default(50) }) as never,
    )
    const inventory = () => api.services.get('items:inventory')
    const byBlock = () => new Map(paths.all().map((p) => [p.block, p]))

    const registerItems = () => {
      const items = api.registry('items')
      for (const p of paths.all()) {
        if (items.has(p.id)) continue
        items.register({ id: p.id, name: p.name, description: 'Проложите дорожку: действие на траве, песке или земле.', stack: cfg.pathStack, price: p.price, icon: { block: p.block }, tags: ['landscaping:paths'] })
      }
    }
    api.events.on('content:loaded', registerItems)
    registerItems()

    // What each paved cell was before (to give it back), saved with the island.
    const under = new Map<string, string>()
    const key = (x: number, z: number) => `${x},${z}`
    api.save.register<Array<[string, string]>>({
      version: 1,
      save: () => [...under],
      load: (d) => {
        under.clear()
        for (const [k, v] of d) under.set(k, v)
      },
    })
    // Heights of the island as generated: terraforming stays within a few blocks of them.
    let original: Int16Array | null = null
    api.events.on('world:generated', () => {
      const sx = api.world.sizeX
      original = new Int16Array(sx * api.world.sizeZ)
      for (let z = 0; z < api.world.sizeZ; z++) for (let x = 0; x < sx; x++) original[x + z * sx] = api.world.surfaceY(x, z)
      under.clear()
    })

    const occupied = (x: number, z: number) => {
      if (api.world.blockerAt(x, z)) return true
      for (const e of api.entities.world.with('transform')) if (Math.floor(e.transform.x) === x && Math.floor(e.transform.z) === z) return true
      return false
    }
    const outdoors = () => !api.interiors.current

    const interactions = api.registry('interactions')
    interactions.register({
      id: 'landscaping:pave',
      tool: '#landscaping:paths',
      priority: 25,
      label: 'Проложить дорожку',
      sound: 'core:dig',
      particles: 'core:clods',
      particleColor: 'block',
      when: (ctx) => {
        const p = paths.get(ctx.held ?? '')
        if (!p || !outdoors() || ctx.block === p.block) return false
        const paved = byBlock().has(ctx.block)
        return (paved || cfg.pavable.includes(ctx.block)) && api.world.getBlock(ctx.x, ctx.y + 1, ctx.z) === api.world.AIR && !api.world.blockerAt(ctx.x, ctx.z)
      },
      run: (ctx) => {
        const p = paths.get(ctx.held!)!
        if (inventory().remove(ctx.actor, p.id, 1) < 1) return false
        const prev = byBlock().get(ctx.block)
        if (prev) inventory().add(ctx.actor, prev.id, 1, { quiet: true }) // repaving gives the old kit back
        else under.set(key(ctx.x, ctx.z), ctx.block)
        api.world.setBlock(ctx.x, ctx.y, ctx.z, p.block)
      },
    })
    interactions.register({
      id: 'landscaping:unpave',
      tool: '#core:shovels',
      button: 'secondary',
      priority: 30,
      label: 'Снять дорожку',
      sound: 'core:dig',
      particles: 'core:clods',
      particleColor: 'block',
      when: (ctx) => outdoors() && byBlock().has(ctx.block),
      run: (ctx) => {
        const p = byBlock().get(ctx.block)!
        if (inventory().add(ctx.actor, p.id, 1) > 0) return false
        api.world.setBlock(ctx.x, ctx.y, ctx.z, under.get(key(ctx.x, ctx.z)) ?? cfg.top)
        under.delete(key(ctx.x, ctx.z))
      },
    })

    const opAt = (ctx: { actor: { transform?: { y: number } }; x: number; z: number; y: number; block: string }) => {
      if (!outdoors() || !original || !cfg.pavable.includes(ctx.block) || occupied(ctx.x, ctx.z)) return null
      if (api.hooks.run('movement:blocked', false, { x: ctx.x, y: ctx.y + 1, z: ctx.z })) return null // a hole, a tree…
      const stand = ctx.y + 1
      return terraformOp(stand, ctx.actor.transform?.y ?? stand, original[ctx.x + ctx.z * api.world.sizeX] ?? stand, cfg)
    }
    interactions.register({
      id: 'landscaping:terraform',
      tool: '#core:shovels',
      button: 'secondary',
      priority: 20,
      label: (ctx) => (opAt(ctx) === 'lower' ? 'Срыть' : 'Насыпать'),
      sound: 'core:dig',
      particles: 'core:clods',
      particleColor: 'block',
      when: (ctx) => opAt(ctx) !== null,
      run: (ctx) => {
        const op = opAt(ctx)
        if (op === 'raise') {
          if (ctx.block === cfg.top) api.world.setBlock(ctx.x, ctx.y, ctx.z, cfg.under)
          return api.world.setBlock(ctx.x, ctx.y + 1, ctx.z, ctx.block === cfg.under ? cfg.top : ctx.block)
        }
        if (op === 'lower') {
          if (!api.world.setBlock(ctx.x, ctx.y, ctx.z, api.world.AIR)) return false
          // the new top: grass where there was soil
          if (api.world.getBlock(ctx.x, ctx.y - 1, ctx.z) === cfg.under && ctx.block === cfg.top) api.world.setBlock(ctx.x, ctx.y - 1, ctx.z, cfg.top)
          return true
        }
        return false
      },
    })
  },
})
