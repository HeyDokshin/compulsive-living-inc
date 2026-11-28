/**
 * Inside Тоша's shop: a room of its own behind the stall. Today's goods stand on the shelves along
 * the walls and on the tables in the middle — walk up to a thing and buy it; Тоша waits behind the
 * counter at the back (talk to her there for the sell box and today's prices). Sold-out things are
 * gone from the shelves until tomorrow.
 */
import type { Entity, PluginApi, ReadonlySignal, Services } from '@sdk'

type Three = PluginApi['render']['three']
type Obj = InstanceType<Three['Object3D']>
type Shell = ReturnType<Services['rooms:kit']['build']>

export const SHOP_ROOM = 'shop:room'
const W = 12
const D = 10
const FLOOR = 8
const WALLS = 4

export interface ShopRoom {
  /** Into the shop (from the stall). */
  enter(actor: Entity): void
  /** Тоша inside (for the conversation's close-up), while the shop is shown. */
  keeper(): Obj | null
  inside(): boolean
}

export function setupShopRoom(
  api: PluginApi,
  opts: {
    shop: Services['shop:counter']
    version: ReadonlySignal<number>
    keeperScale: number
    onCounter: () => void
    /** Тоша is talking (she nods). */
    talking: () => boolean
  },
): ShopRoom {
  const T = api.render.three
  api.interiors.define(SHOP_ROOM, { name: 'Лавка Тоши', icon: '🛍️' })
  const inside = () => api.interiors.current === SHOP_ROOM
  const makePlan = () => {
    const a = api.interiors.area(SHOP_ROOM)
    const x0 = a.x + Math.floor((a.w - W) / 2)
    const z0 = a.z + Math.floor((a.d - D) / 2)
    const cells: Array<{ x: number; z: number }> = []
    // shelves along the side walls, by the back wall either side of the counter, two tables in the middle
    for (let z = z0 + 2; z <= z0 + D - 3; z++) cells.push({ x: x0 + 1, z }, { x: x0 + W - 2, z })
    for (const x of [x0 + 1, x0 + 2, x0 + 3, x0 + W - 4, x0 + W - 3, x0 + W - 2]) cells.push({ x, z: z0 + 1 })
    const tables = [x0 + 4, x0 + 5, x0 + 6, x0 + 7].map((x) => ({ x, z: z0 + 5 }))
    const counter = [x0 + 4, x0 + 5, x0 + 6, x0 + 7].map((x) => ({ x, z: z0 + 2 }))
    return { x0, z0, door: { x: x0 + W / 2, z: z0 + D - 1 }, shelves: cells, tables, counter, keeper: { x: x0 + W / 2, z: z0 + 1.5 } }
  }
  // the room lies where its number puts it: worked out again for each visit and each island, kept in between
  let planned: ReturnType<typeof makePlan> | null = null
  const plan = () => (planned ??= makePlan())
  api.events.on('interior:changed', () => void (planned = null))
  api.events.on('session:started', () => void (planned = null))

  // --- the room: invisible blocks, the shell, the shelves and the counter ---------------------------
  let shell: Shell | null = null
  const build = () => {
    const p = plan()
    const w = api.world
    for (let z = p.z0; z < p.z0 + D; z++)
      for (let x = p.x0; x < p.x0 + W; x++) {
        w.setBlock(x, FLOOR, z, 'shop:floor')
        const ring = x === p.x0 || z === p.z0 || x === p.x0 + W - 1 || z === p.z0 + D - 1
        if (ring) for (let y = FLOOR + 1; y <= FLOOR + WALLS; y++) w.setBlock(x, y, z, 'shop:wall')
      }
    for (const c of [...p.shelves, ...p.tables, ...p.counter]) w.setBlock(c.x, FLOOR + 1, c.z, 'shop:fixture')
    shell?.dispose()
    shell = null
    if (!api.services.has('rooms:kit')) return
    shell = api.services.get('rooms:kit').build({
      box: { x0: p.x0, z0: p.z0, w: W, d: D },
      floorY: FLOOR + 1,
      height: WALLS,
      doors: [p.door],
      windows: [
        { x: p.x0, z: p.z0 + D - 3 },
        { x: p.x0 + W - 1, z: p.z0 + D - 3 },
      ],
      look: {
        wall: { material: 'house:paper_stripes', color: '#ffe7c4' },
        wainscot: { material: 'house:panel', color: '#e2b98c', height: 1.1 },
        floor: { material: 'house:parquet', color: '#c99566' },
        trim: { material: 'house:painted_wood', color: '#fbf3e6' },
        door: { material: 'core:wood', color: '#d98f6a' },
        curtain: { material: 'house:curtain', color: '#ffd9c8' },
        mat: { material: 'house:doormat', color: '#e8c39a' },
      },
      builtIns: [
        { cells: p.shelves, body: { material: 'core:wood', color: '#d9a56c' }, top: { material: 'core:planks', color: '#ffffff' }, height: 1 },
        { cells: p.tables, body: { material: 'house:panel', color: '#f1e4d0' }, top: { material: 'core:wood', color: '#e8c08e' }, height: 0.9 },
        { cells: p.counter, body: { material: 'house:panel', color: '#c98d5a' }, top: { material: 'core:wood', color: '#e2b47e' }, height: 1.05 },
      ],
    })
  }

  // --- the goods on display ------------------------------------------------------------------------
  const group = api.render.add(new T.Group())
  group.visible = false
  /** What stands in each display cell (`x,z` → item id). */
  const shown = new Map<string, string>()
  let shownVersion = -1
  /** Icon sprites of things without a model (their materials and textures are ours to free). */
  const icons: Array<InstanceType<Three['SpriteMaterial']>> = []
  /** Bumped each time the display is rebuilt: an icon that comes in late for an old one is dropped. */
  let generation = 0
  const clearDisplay = () => {
    generation++
    group.clear()
    shown.clear()
    for (const m of icons) {
      m.map?.dispose()
      m.dispose()
    }
    icons.length = 0
  }
  const display = () => {
    clearDisplay()
    shownVersion = opts.version.value
    const p = plan()
    const slots = [...p.shelves, ...p.tables]
    // every good keeps its place all day: a sold-out one leaves its spot empty
    const goods = opts.shop.today().flatMap((s) => s.goods)
    const items = api.registry('items')
    goods.slice(0, slots.length).forEach((g, i) => {
      if (g.left <= 0) return
      const c = slots[i]!
      const top = FLOOR + 1 + (p.tables.includes(c) ? 0.9 : 1)
      shown.set(`${c.x},${c.z}`, g.id)
      const def = items.get(g.id)
      const holder = new T.Group()
      holder.position.set(c.x + 0.5, top, c.z + 0.5)
      // turned to the middle of the room, a little each way
      holder.rotation.y = Math.atan2(p.x0 + W / 2 - c.x, p.z0 + D / 2 - c.z) + Math.sin(i * 2.3) * 0.25
      if (def?.model) holder.add(api.render.voxelModel(def.model, { palette: def.palette }))
      else {
        // no model (a wallpaper, a floor): its icon on a little stand
        const gen = generation
        void api.ui.itemIcon(g.id).then((url) => {
          if (gen !== generation) return
          const tex = new T.TextureLoader().load(url)
          tex.colorSpace = T.SRGBColorSpace
          const mat = new T.SpriteMaterial({ map: tex })
          icons.push(mat)
          const sprite = new T.Sprite(mat)
          sprite.scale.setScalar(0.6)
          sprite.position.y = 0.35
          holder.add(sprite)
        })
      }
      group.add(holder)
    })
  }

  // --- Тоша behind the counter ------------------------------------------------------------------------
  let keeper: Obj | null = null
  const players = api.entities.world.with('player', 'transform')
  let time = 0
  api.systems.add({
    id: 'shopRoom',
    phase: 'render',
    run: ({ dt }) => {
      if (!inside()) return
      time += dt
      if (shownVersion !== opts.version.value) display()
      if (!keeper) {
        keeper = api.render.rigModel('shop:keeper')
        keeper.scale.setScalar(opts.keeperScale)
        const k = plan().keeper
        keeper.position.set(k.x, FLOOR + 1, k.z)
        group.parent?.add(keeper)
      }
      for (const pl of players) {
        const face = Math.atan2(pl.transform.x - keeper.position.x, pl.transform.z - keeper.position.z)
        const d = Math.atan2(Math.sin(face - keeper.rotation.y), Math.cos(face - keeper.rotation.y))
        keeper.rotation.y += d * Math.min(1, dt * 4)
        // out through the door
        const door = plan().door
        if (!api.interiors.changing && Math.floor(pl.transform.x) === door.x && Math.floor(pl.transform.z) === door.z) {
          api.interiors.exit(pl)
          api.audio.play('ui:close')
        }
        break
      }
      const body = keeper.getObjectByName('body')
      const head = keeper.getObjectByName('head')
      if (body) body.scale.y = 1 + Math.sin(time * 2.6) * 0.025
      if (head) head.rotation.x = opts.talking() ? Math.sin(time * 10) * 0.09 + 0.04 : Math.sin(time * 0.8) * 0.03
    },
  })
  const leave = () => {
    shell?.dispose()
    shell = null
    group.visible = false
    clearDisplay()
    keeper?.removeFromParent()
    keeper = null
  }
  api.events.on('interior:changed', ({ id }) => {
    if (id !== SHOP_ROOM) return leave()
    build()
    group.visible = true
    display()
  })
  api.events.on('session:started', () => {
    if (!inside()) return
    build()
    group.visible = true
    display()
  })
  api.onDispose(leave)

  // --- buying from the shelves, talking at the counter --------------------------------------------------
  const interactions = api.registry('interactions')
  const goodAt = (ctx: { x: number; z: number }) => (inside() ? shown.get(`${ctx.x},${ctx.z}`) : undefined)
  const priceOf = (id: string) =>
    opts.shop
      .today()
      .flatMap((s) => s.goods)
      .find((g) => g.id === id)
  interactions.register({
    id: 'shop:buy',
    priority: 65,
    anim: 'none',
    label: (ctx) => {
      const id = goodAt(ctx)!
      return `Купить: ${api.registry('items').get(id)?.name ?? id} · ${priceOf(id)?.price ?? '?'} 🔔`
    },
    when: (ctx) => !!goodAt(ctx),
    run: (ctx) => {
      const id = goodAt(ctx)!
      const r = opts.shop.buy(ctx.actor, id)
      const name = api.registry('items').get(id)?.name ?? id
      if (r === 'ok') void api.ui.itemIcon(id).then((icon) => api.ui.toast(`Куплено: ${name}`, { icon }))
      else api.ui.toast(r === 'poor' ? 'Не хватает колокольчиков.' : r === 'full' ? 'Карманы полны.' : 'Этого уже нет.')
      return r === 'ok'
    },
  })
  interactions.register({
    id: 'shop:counter_talk',
    priority: 64,
    anim: 'none',
    sound: 'ui:open',
    label: 'Поговорить с Тошей',
    when: (ctx) => inside() && plan().counter.some((c) => c.x === ctx.x && c.z === ctx.z),
    run: () => opts.onCounter(),
  })

  return {
    enter(actor) {
      const d = plan().door
      api.interiors.enter(SHOP_ROOM, actor, { x: d.x + 0.5, y: FLOOR + 1, z: d.z - 0.5, rotY: Math.PI })
    },
    keeper: () => keeper,
    inside,
  }
}
