/**
 * The market stall and Тоша, the red panda who runs it. Shelves are data (content/shop/shop.shelves.json5):
 * each takes goods by tag and shows a few of them per day — the same all day, new tomorrow — with a
 * daily stock. Buying spends bells from the `economy:wallet`. From the counter you can also open the
 * sell box and today's market prices.
 */
import { definePlugin, signal, z, type Entity, type RegistryEntry } from '@sdk'
import { Counter } from './counter'
import { pickDaily } from './stock'

export interface ShelfDef extends RegistryEntry {
  name: string
  tag?: string
  items?: string[]
  count: number
  stock: number
  markup: number
  order: number
}

export interface DialogueDef extends RegistryEntry {
  lines: string[]
}

export interface Shop {
  /** Today's shelves: item ids with price and how many are left (Infinity = no limit). */
  today(): Array<{ shelf: ShelfDef; goods: Array<{ id: string; price: number; left: number }> }>
  buy(actor: Entity, itemId: string): 'ok' | 'poor' | 'full' | 'sold_out' | 'unknown'
}

declare module '@sdk' {
  interface Components {
    shopStall?: Record<string, never>
  }
  interface Registries {
    'shop:shelves': ShelfDef
    'shop:dialogue': DialogueDef
  }
  interface Services {
    'shop:counter': Shop
  }
  interface GameEvents {
    'shop:bought': { id: string; price: number }
  }
}

const Config = z.object({
  /** Stall footprint (cells) — matches the model (48 × 32 voxels at 1/16). */
  width: z.number().int().min(1).max(8).default(3).meta({ step: 1 }),
  depth: z.number().int().min(1).max(8).default(2).meta({ step: 1 }),
  frontRows: z.number().int().min(1).max(4).default(2).meta({ label: 'front rows', step: 1 }),
  /** Keep this far from other big buildings (cells). */
  clearance: z.number().int().min(0).max(10).default(3).meta({ step: 1 }),
  keeperScale: z.number().min(0.3).max(3).default(1.2).meta({ label: 'keeper scale', step: 0.05 }),
  typeSpeed: z.number().min(0.005).max(0.2).default(0.026).meta({ label: 'type speed (s)', step: 0.002 }),
  voicePitch: z.number().min(80).max(1200).default(520).meta({ label: 'voice pitch', step: 10 }),
})

export default definePlugin({
  id: 'shop',
  version: '0.1.0',
  description: 'Лавка Тоши: товары дня, открытки с рецептами, саженцы, семена',
  dependsOn: ['items', 'economy'],
  // after the museum and the sell box: the stall takes the next free plot
  optionalDependsOn: ['museum', 'decor', 'nature', 'garden', 'daily', 'tutorial', 'cutscene'],

  setup(api) {
    const cfg = api.config.define(Config)
    const shelves = api.createRegistry<ShelfDef>(
      'shop:shelves',
      z.looseObject({
        id: z.string(),
        name: z.string(),
        tag: z.string().optional(),
        items: z.array(z.string()).optional(),
        count: z.number().int().min(0).default(0),
        stock: z.number().int().min(0).default(0),
        markup: z.number().min(0).default(1),
        order: z.number().default(0),
      }) as never,
    )
    api.createRegistry<DialogueDef>('shop:dialogue', z.looseObject({ id: z.string(), lines: z.array(z.string()).min(1) }) as never)
    api.components.define('shopStall', z.object({}))
    const wallet = () => api.services.get('economy:wallet')
    const inventory = () => api.services.get('items:inventory')
    const items = api.registry('items')

    // Bought today, per item (reset each day); whether we've met.
    let day = -1
    let met = false
    const bought = new Map<string, number>()
    const version = signal(0)
    const roll = () => {
      if (day === api.time.dayIndex) return
      day = api.time.dayIndex
      bought.clear()
      version.value++
    }
    api.save.register<{ day: number; bought: Record<string, number>; met: boolean }>({
      version: 1,
      save: () => ({ day, bought: Object.fromEntries(bought), met }),
      load: (d) => {
        day = d.day
        met = d.met
        bought.clear()
        for (const [id, n] of Object.entries(d.bought)) bought.set(id, n)
      },
    })
    api.events.on('time:day', roll)

    const shop: Shop = {
      today: () => {
        roll()
        return shelves
          .all()
          .sort((a, b) => a.order - b.order)
          .map((shelf) => {
            const pool = (shelf.items ?? (shelf.tag ? items.tagged(shelf.tag).map((i) => i.id) : [])).filter((id) => items.has(id)).sort()
            const ids = shelf.count > 0 ? pickDaily(pool, shelf.count, api.world.seed, api.time.dayIndex, shelf.id) : pool
            return {
              shelf,
              goods: ids.map((id) => ({
                id,
                price: Math.max(1, Math.round((items.get(id)?.price ?? 0) * shelf.markup)),
                left: shelf.stock > 0 ? Math.max(0, shelf.stock - (bought.get(id) ?? 0)) : Infinity,
              })),
            }
          })
          .filter((s) => s.goods.length)
      },
      buy: (actor, id) => {
        const g = shop
          .today()
          .flatMap((s) => s.goods)
          .find((x) => x.id === id)
        if (!g) return 'unknown'
        if (g.left <= 0) return 'sold_out'
        if (wallet().bells.value < g.price) return 'poor'
        if (inventory().add(actor, id, 1, { quiet: true }) > 0) return 'full'
        wallet().spend(g.price)
        bought.set(id, (bought.get(id) ?? 0) + 1)
        version.value++
        api.events.emit('shop:bought', { id, price: g.price })
        api.audio.play('economy:coins')
        return 'ok'
      },
    }
    api.services.provide('shop:counter', shop)

    // --- the stall -----------------------------------------------------------------------------
    const stalls = () => [...api.entities.world.with('shopStall', 'transform')]
    const grass = (x: number, z: number) => {
      const y = api.world.surfaceY(x, z)
      return y === api.world.ground && api.world.getBlock(x, y - 1, z) === 'core:grass' && api.world.getBlock(x, y, z) === api.world.AIR ? y : null
    }
    const plotAt = (x0: number, z0: number): number | null => {
      const base = grass(x0, z0)
      if (base === null) return null
      for (let dz = 0; dz < cfg.depth + cfg.frontRows; dz++)
        for (let dx = 0; dx < cfg.width; dx++) {
          const y = grass(x0 + dx, z0 + dz)
          if (y === null || y !== base || api.world.blockerAt(x0 + dx, z0 + dz)) return null
        }
      const r = cfg.clearance
      for (let dz = -r; dz < cfg.depth + cfg.frontRows + r; dz++)
        for (let dx = -r; dx < cfg.width + r; dx++) if ((api.world.blockerAt(x0 + dx, z0 + dz)?.blocker?.w ?? 1) > 1) return null
      return base
    }
    const placeStall = () => {
      const cx = Math.floor(api.world.sizeX / 2 - cfg.width / 2)
      const cz = Math.floor(api.world.sizeZ / 2 - cfg.depth / 2)
      for (let r = 2; r < api.world.sizeX / 2; r++)
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
            const x0 = cx + dx
            const z0 = cz + dz
            const y = plotAt(x0, z0)
            if (y === null) continue
            // clear small things (flowers, items) off the plot
            for (const e of [...api.entities.world.with('transform')]) {
              const ex = Math.floor(e.transform.x)
              const ez = Math.floor(e.transform.z)
              if (ex >= x0 && ex < x0 + cfg.width && ez >= z0 && ez < z0 + cfg.depth + cfg.frontRows && !e.inventory) api.entities.despawn(e)
            }
            return api.entities.spawn({
              name: 'Лавка Тоши',
              transform: { x: x0 + cfg.width / 2, y, z: z0 + cfg.depth / 2, rotY: 0 },
              model: { shape: 'voxel', ref: 'shop:stall', size: [cfg.width, 3, cfg.depth], color: '#d9a56c', anchor: 'bottom' },
              blocker: { w: cfg.width, d: cfg.depth, h: 3 },
              shopStall: {},
            })
          }
      return null
    }
    api.events.on('session:started', () => {
      roll()
      if (!stalls().length && !placeStall()) api.log.warn('no place for the shop stall')
    })

    // The keeper behind the counter: breathes, turns to you, nods while talking.
    const T = api.render.three
    const group = api.render.add(new T.Group())
    group.visible = !api.interiors.current
    api.events.on('interior:changed', ({ id }) => void (group.visible = !id))
    let keeper: InstanceType<typeof T.Object3D> | null = null
    let talking = false
    let time = 0
    const stallQuery = api.entities.world.with('shopStall', 'transform')
    const players = api.entities.world.with('player', 'transform')
    api.systems.add({
      id: 'keeper',
      phase: 'render',
      run: ({ dt }) => {
        time += dt
        let stall: (typeof stallQuery.entities)[number] | undefined
        for (const e of stallQuery) {
          stall = e
          break
        }
        if (!stall) return
        if (!keeper) {
          keeper = api.render.rigModel('shop:keeper')
          keeper.scale.setScalar(cfg.keeperScale)
          group.add(keeper)
        }
        // behind the counter, in the back row of the stall
        keeper.position.set(stall.transform.x, stall.transform.y, stall.transform.z - cfg.depth / 2 + 0.55)
        let pl: (typeof players.entities)[number] | undefined
        for (const e of players) {
          pl = e
          break
        }
        if (pl) {
          const face = Math.atan2(pl.transform.x - keeper.position.x, pl.transform.z - keeper.position.z)
          const want = api.services.has('cutscene:talk') ? api.services.get('cutscene:talk').cheat(face) : face
          const d = Math.atan2(Math.sin(want - keeper.rotation.y), Math.cos(want - keeper.rotation.y))
          keeper.rotation.y += d * Math.min(1, dt * 5)
        }
        const body = keeper.getObjectByName('body')
        const head = keeper.getObjectByName('head')
        if (body) body.scale.y = 1 + Math.sin(time * 2.6) * 0.025
        if (head) {
          head.rotation.x = talking ? Math.sin(time * 10) * 0.09 + 0.04 : Math.sin(time * 0.8) * 0.03
          head.rotation.z = talking ? 0 : Math.sin(time * 0.6) * 0.1
        }
      },
    })
    api.events.on('session:started', () => {
      keeper?.removeFromParent()
      keeper = null
    })

    api.registry('interactions').register({
      id: 'shop:talk',
      entity: 'shopStall',
      priority: 50,
      anim: 'none',
      sound: 'ui:open',
      label: 'Поговорить с Тошей',
      run: () => void api.ui.open('shop:counter'),
    })
    // talking to Tosha is a close-up of the two of you
    if (api.services.has('cutscene:talk')) api.services.get('cutscene:talk').conversation('shop:counter', () => keeper)
    api.ui.window({
      id: 'shop:counter',
      title: 'Лавка Тоши',
      backdrop: 'clear',
      align: 'bottom',
      component: () => (
        <Counter
          api={api}
          shop={shop}
          version={version}
          firstMeeting={() => {
            const first = !met
            met = true
            return first
          }}
          setTalking={(on) => void (talking = on)}
          typeSpeed={cfg.typeSpeed}
          voicePitch={cfg.voicePitch}
        />
      ),
    })

    try {
      api.registry('daily:sections').register({
        id: 'shop:today',
        order: 35,
        line: () => {
          const daily = shop.today().filter((s) => s.shelf.count > 0)
          const names = daily.flatMap((s) => s.goods.map((g) => items.get(g.id)?.name ?? g.id)).slice(0, 4)
          return names.length && stalls().length ? { icon: '🛍', text: `У Тоши сегодня: ${names.join(', ')}.` } : null
        },
      })
    } catch {
      // no daily notes
    }

    try {
      api.registry('tutorial:steps').register({
        id: 'shop:tutorial_visit',
        order: 82,
        day: 2,
        text: 'Познакомьтесь с Тошей: красная панда держит лавку в центре острова.',
        keys: ['player:use'],
        event: 'ui:opened',
        when: (p: { id: string }) => p.id === 'shop:counter',
      })
    } catch {
      // no tutorial
    }

    api.commands.register({
      name: 'shop',
      description: 'Товары дня в лавке',
      run: () =>
        shop
          .today()
          .map((s) => `${s.shelf.name}: ${s.goods.map((g) => `${items.get(g.id)?.name ?? g.id} ${g.price}🔔${Number.isFinite(g.left) ? ` (${g.left})` : ''}`).join(', ')}`)
          .join('\n'),
    })
  },
})
