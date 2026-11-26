/**
 * Items in the world and in pockets:
 * - `inventory` component + the `items:inventory` service other plugins use (add, remove, equip, drop…)
 * - pockets window (I / Tab), held-item HUD, cycling tools (R), dropping (G)
 * - items on the ground (`item` component), picked up through the interaction matrix
 * - the held item appears in the character's hand
 * - shells washed up on beaches
 */
import { definePlugin, signal, ui, z, type Entity, type PluginApi, type ReadonlySignal, type Signal } from '@sdk'
import { addItems, countItems, createInventory, heldItem, moveSlot, removeItems, takeFromSlot, type Inventory, type Stack } from './inventory'

export type { Inventory, Stack } from './inventory'

declare module '@sdk' {
  interface Components {
    inventory?: Inventory
    /** An item stack lying on the ground. */
    item?: Stack & { dropped?: boolean }
  }
  interface Services {
    'items:inventory': InventoryService
  }
  interface GameEvents {
    'items:changed': { actor: Entity }
    /** Found or gathered (not bought, crafted into place or taken from a chest). */
    'items:picked': { actor: Entity; id: string; count: number }
  }
}

export interface InventoryService {
  of(actor: Entity): Inventory | undefined
  /** Returns how many did NOT fit. Shows a toast unless `quiet`; `moved` = it was theirs already (not a find). */
  add(actor: Entity, id: string, count?: number, opts?: { quiet?: boolean; moved?: boolean }): number
  remove(actor: Entity, id: string, count?: number): number
  count(actor: Entity, id: string): number
  held(actor: Entity): string | null
  equip(actor: Entity, slot: number | null): void
  cycleTools(actor: Entity, dir: 1 | -1): void
  /** Drop from a slot onto the cell in front of the actor. */
  drop(actor: Entity, slot: number, count?: number): Entity | null
  spawnDrop(id: string, count: number, x: number, y: number, z: number): Entity
  /** Bumps on every change — read it in UI components to re-render. */
  readonly version: ReadonlySignal<number>
}

const Kit = z.array(z.object({ id: z.string(), count: z.number().int().min(1) }))

const Config = z.object({
  pocketSize: z.number().int().min(1).max(60).default(20).meta({ label: 'pocket slots', step: 1 }),
  /** Entities spawned with this component get pockets and the starting kit. */
  giveTo: z.string().default('player'),
  startingKit: Kit.default([
    { id: 'core:shovel', count: 1 },
    { id: 'core:axe', count: 1 },
    { id: 'core:net', count: 1 },
    { id: 'core:fishing_rod', count: 1 },
    { id: 'core:watering_can', count: 1 },
    { id: 'core:apple', count: 3 },
  ]),
  shells: z.number().int().min(0).max(100).default(12).meta({ label: 'shells on beaches', step: 1 }),
  pickupToasts: z.boolean().default(true).meta({ label: 'pickup toasts' }),
  heldScale: z.number().min(0.2).max(3).default(1.4).meta({ label: 'held item scale', step: 0.05 }),
  /** Seconds between glints on items lying nearby (0 = none). */
  glintEvery: z.number().min(0.2).max(30).default(1.4).meta({ label: 'glint every (s)', step: 0.1 }),
})
type Config = z.infer<typeof Config>

export default definePlugin({
  id: 'items',
  version: '0.1.1',
  description: 'Предметы: карманы, предметы на земле, подбор, в руках',

  setup(api) {
    const cfg = api.config.define(Config)
    const items = api.registry('items')
    const version = signal(0)
    const changed = (actor: Entity) => {
      version.value++
      api.events.emit('items:changed', { actor })
    }
    // Pockets can also appear without going through the service (restored from a save, spawned):
    // refresh the UI then too.
    api.events.on('session:started', () => void version.value++)
    api.events.on('entity:spawned', ({ entity }) => entity.inventory && void version.value++)
    const maxStack = (id: string) => items.get(id)?.stack ?? 10
    const nameOf = (id: string) => items.get(id)?.name ?? id

    api.components.define(
      'inventory',
      z.object({
        slots: z.array(z.object({ id: z.string(), count: z.number().int().min(1) }).nullable()),
        equipped: z.number().int().nullable().default(null),
      }),
    )
    api.components.define('item', z.object({ id: z.string(), count: z.number().int().min(1).default(1), dropped: z.boolean().optional() }))

    // Pockets + starting kit for the configured component (the player).
    api.hooks.tap('entity:beforeSpawn', (comps) => {
      const c = comps as Record<string, unknown>
      if (c[cfg.giveTo] === undefined || c.inventory) return comps
      const inv = createInventory(cfg.pocketSize)
      for (const k of cfg.startingKit) addItems(inv, k.id, k.count, maxStack(k.id))
      return { ...comps, inventory: inv }
    })
    api.hooks.tap('interaction:held', (held, { actor }) => (actor.inventory ? heldItem(actor.inventory) : held))

    const front = (actor: Entity) => {
      const t = actor.transform!
      return { x: Math.floor(t.x + Math.sin(t.rotY) * 0.9), z: Math.floor(t.z + Math.cos(t.rotY) * 0.9) }
    }

    const service: InventoryService = {
      version,
      of: (a) => a.inventory,
      add(actor, id, count = 1, opts) {
        if (!actor.inventory) return count
        if (!items.has(id)) api.log.warn(`unknown item "${id}"`)
        const left = addItems(actor.inventory, id, count, maxStack(id))
        const got = count - left
        if (got > 0) {
          changed(actor)
          // quiet = moved around (a chest, a shop, a reward), not found or gathered
          if (!opts?.quiet && !opts?.moved) api.events.emit('items:picked', { actor, id, count: got })
          if (!opts?.quiet && cfg.pickupToasts) {
            void api.ui.itemIcon(id).then((icon) => api.ui.toast(`${nameOf(id)}${got > 1 ? ` ×${got}` : ''}`, { icon }))
          }
        }
        return left
      },
      remove(actor, id, count = 1) {
        if (!actor.inventory) return 0
        const n = removeItems(actor.inventory, id, count)
        if (n) changed(actor)
        return n
      },
      count: (actor, id) => (actor.inventory ? countItems(actor.inventory, id) : 0),
      held: (actor) => (actor.inventory ? heldItem(actor.inventory) : null),
      equip(actor, slot) {
        const inv = actor.inventory
        if (!inv) return
        const next = slot !== null && inv.slots[slot] ? slot : null
        if (next !== inv.equipped) api.audio.play('core:equip')
        inv.equipped = next
        changed(actor)
      },
      cycleTools(actor, dir) {
        const inv = actor.inventory
        if (!inv) return
        // Cycle through tool slots and empty hands.
        const order: Array<number | null> = [null]
        inv.slots.forEach((s, i) => s && items.isTagged(s.id, '#core:tools') && order.push(i))
        const at = Math.max(0, order.indexOf(inv.equipped))
        const next = order[(at + dir + order.length) % order.length]!
        service.equip(actor, next)
        const id = heldItem(inv)
        if (id) void api.ui.itemIcon(id).then((icon) => api.ui.toast(nameOf(id), { icon, ms: 900 }))
      },
      drop(actor, slot, count) {
        const inv = actor.inventory
        const s = inv?.slots[slot]
        if (!inv || !s) return null
        let { x, z } = front(actor)
        let y = api.world.surfaceY(x, z)
        const top = api.world.getBlock(x, y - 1, z)
        const t = actor.transform!
        if (y <= 0 || Math.abs(y - t.y) > 1 || api.registry('blocks').isTagged(top, '#core:liquid') || api.world.isSolid(x, y, z)) {
          x = Math.floor(t.x)
          z = Math.floor(t.z)
          y = t.y
        }
        const taken = takeFromSlot(inv, slot, count ?? s.count)!
        changed(actor)
        api.audio.play('core:drop', { at: { x: x + 0.5, z: z + 0.5 } })
        api.fx.burst('core:dust', { x: x + 0.5, y, z: z + 0.5 }, { amount: 0.75 })
        const e = service.spawnDrop(taken.id, taken.count, x + 0.5, y, z + 0.5)
        e.item!.dropped = true
        return e
      },
      spawnDrop(id, count, x, y, z) {
        const def = items.get(id)
        return api.entities.spawn('items:drop', {
          name: def?.name ?? id,
          transform: { x, y, z, rotY: Math.random() * Math.PI * 2 },
          item: { id, count },
          model: def?.model ? { shape: 'voxel', ref: def.model, palette: def.palette, size: [1, 1, 1], color: '#ccc', anchor: 'bottom' } : { shape: 'box', size: [0.3, 0.3, 0.3], color: def?.icon?.color ?? '#ccc', anchor: 'bottom' },
        })
      },
    }
    api.services.provide('items:inventory', service)

    // --- interactions --------------------------------------------------------------------
    const interactions = api.registry('interactions')
    interactions.register({
      id: 'items:pickup',
      entity: 'item',
      priority: 100,
      anim: 'pickup',
      sound: 'core:pickup',
      particles: 'core:sparkle',
      label: (ctx) => `Подобрать: ${nameOf(ctx.target!.item!.id)}`,
      run: (ctx) => {
        const target = ctx.target!
        const it = target.item!
        const left = service.add(ctx.actor, it.id, it.count, { moved: it.dropped })
        if (left === it.count) {
          api.ui.toast('Карманы полны')
          return false
        }
        if (left > 0) it.count = left
        else api.entities.despawn(target)
      },
    })
    interactions.register({
      id: 'items:eat',
      tool: '#core:fruits',
      priority: -50,
      anim: 'pickup',
      sound: 'core:eat',
      particles: 'core:munch',
      label: (ctx) => `Съесть: ${nameOf(ctx.held!)}`,
      run: (ctx) => {
        service.remove(ctx.actor, ctx.held!, 1)
        api.ui.toast('Ням! Вкусно.')
      },
    })

    // --- input ----------------------------------------------------------------------------
    const owner = () => {
      for (const e of api.entities.world.with('inventory', cfg.giveTo as 'inventory')) return e
      return undefined
    }
    const pocketsKey = api.input.action('pockets', ['KeyI', 'Tab', 'Pad3'], 'Карманы')
    const cycleKey = api.input.action('cycleTool', ['KeyR', 'Pad5'], 'Сменить инструмент')
    const cycleBackKey = api.input.action('cycleToolBack', ['Pad4'])
    const dropKey = api.input.action('drop', ['KeyG'], 'Выбросить из рук')
    api.input.on(pocketsKey, () => api.ui.toggle('items:pockets'))
    api.input.on(cycleKey, () => !api.ui.modalOpen.value && withOwner((a) => service.cycleTools(a, 1)))
    api.input.on(cycleBackKey, () => !api.ui.modalOpen.value && withOwner((a) => service.cycleTools(a, -1)))
    api.input.on(dropKey, () => {
      if (api.ui.modalOpen.value) return
      withOwner((a) => {
        const inv = a.inventory!
        if (inv.equipped === null) return api.ui.toast('В руках ничего нет')
        service.drop(a, inv.equipped, 1)
      })
    })
    function withOwner(fn: (a: Entity) => void) {
      const a = owner()
      if (a) fn(a)
    }

    // --- UI -------------------------------------------------------------------------------
    const selected = signal<number | null>(null)
    api.ui.window({ id: 'items:pockets', title: 'Карманы', component: () => <Pockets api={api} service={service} owner={owner} selected={selected} /> })
    api.ui.slot('hud.bottomRight', () => <HeldHud api={api} service={service} owner={owner} />)

    api.commands.register({
      name: 'give',
      description: 'Дать предмет игроку: give core:apple 5',
      usage: '<item id> [count]',
      run: ([id, n]) => {
        const a = owner()
        if (!a) throw new Error('no one to give to')
        if (!id || !items.has(id)) throw new Error(`unknown item "${id}". Items: ${items.ids().join(', ')}`)
        const left = service.add(a, id, Number(n ?? 1))
        return left ? `не поместилось: ${left}` : 'ok'
      },
    })
    api.commands.register({
      name: 'items',
      description: 'Список предметов (или с тегом: items #core:tools)',
      usage: '[#tag]',
      run: ([tag]) => (tag ? items.tagged(tag) : items.all()).map((i) => `${i.id.padEnd(22)} ${i.name}  ×${i.stack}`).join('\n'),
    })

    // --- held item in the hand -----------------------------------------------------------
    const holders = new WeakMap<object, { id: string | null; obj?: InstanceType<PluginApi['render']['three']['Object3D']> }>()
    api.systems.add({
      id: 'heldModel',
      phase: 'render',
      priority: 600,
      run: () => {
        for (const e of api.entities.world.with('inventory', 'view')) {
          const id = heldItem(e.inventory)
          const h = holders.get(e.view) ?? { id: null }
          if (h.id === id && (h.obj || !id)) continue
          h.obj?.removeFromParent()
          h.obj = undefined
          h.id = id
          holders.set(e.view, h)
          const hand = e.view.getObjectByName('armR')
          const model = id ? items.get(id)?.model : undefined
          if (!hand || !model) continue
          const T = api.render.three
          const hold = items.get(id!)?.held
          const holder = new T.Group()
          // The arm lives in rig voxel space (arm → body → scaled rig root): undo the rig scale so the
          // item keeps its own size (models are 1/16 block per voxel), times `heldScale`.
          const rigScale = hand.parent?.parent?.scale.x ?? 1 / 12
          const scale = ((1 / 16) * cfg.heldScale * (hold?.scale ?? 1)) / rigScale
          holder.position.set(0, -3.4, 0.4) // the fist, at the end of the arm
          holder.rotation.x = hold?.tilt ?? 0
          const obj = api.render.voxelModel(model, { scale, palette: items.get(id!)?.palette })
          holder.add(obj)
          // Put the grip voxel in the fist (e.g. a shovel by the top of its handle).
          const grip = hold?.grip
          if (grip) {
            void api.render.modelInfo(model).then((info) => {
              if (!info) return
              const [px, py, pz] = info.pivot
              obj.position.set(-(grip[0] - px) * scale, -(grip[1] - py) * scale, -(grip[2] - pz) * scale)
            })
          }
          hand.add(holder)
          h.obj = holder
        }
      },
    })

    // Ground items: a gentle breathing and an occasional glint so they read as "pick me up".
    let time = 0
    let glintIn = 1
    const drops = api.entities.world.with('item', 'view')
    // Tall things (tools) lie down on the ground instead of standing like posts.
    const laid = new WeakSet<object>()
    const layDown = (e: Entity) => {
      laid.add(e.view!)
      const def = items.get(e.item!.id)
      if (!def?.model || def.ground?.lie === false) return
      const view = e.view!
      void api.render.modelInfo(def.model).then((info) => {
        const inner = view.children[0]
        if (!info || !inner) return
        const [sx, sy, sz] = info.size
        const tall = sy >= 1.6 * Math.max(sx, sz)
        if (!(def.ground?.lie ?? tall)) return
        // rotate about the bottom center: height runs along x, width becomes thickness
        inner.rotation.z = Math.PI / 2
        inner.position.set((sy / 2) * info.scale, (sx / 2) * info.scale, 0)
      })
    }
    api.systems.add({
      id: 'groundBob',
      phase: 'render',
      run: ({ dt }) => {
        time += dt
        glintIn -= dt
        const glintNow = glintIn <= 0
        if (glintNow) glintIn = cfg.glintEvery * (0.6 + Math.random() * 0.8)
        // One pass: bob every drop; pick a random nearby one for the glint (reservoir sampling).
        const c = api.render.camera.target
        let pick: (typeof drops)['entities'][number] | undefined
        let seen = 0
        for (const e of drops) {
          if (!laid.has(e.view)) layDown(e)
          const s = 1 + Math.sin(time * 3 + (e.uid ?? 0)) * 0.04
          e.view.scale.set(s, 1 / s, s)
          if (glintNow && Math.hypot(e.transform!.x - c.x, e.transform!.z - c.z) < 14 && Math.random() * ++seen < 1) pick = e
        }
        if (pick) api.fx.burst('core:glint', { x: pick.transform!.x, y: pick.transform!.y + 0.35, z: pick.transform!.z })
      },
    })
  },

  start(api) {
    const cfg = api.config.define(Config)
    const service = api.services.get('items:inventory')
    const scatter = () => {
      for (const e of [...api.entities.world.with('item')]) api.entities.despawn(e)
      scatterShells(api, cfg, service)
    }
    // First visit only: restored saves (and hot reloads) already have their items on the ground.
    if (!api.save.loaded && ![...api.entities.world.with('item')].length) scatter()
    // A brand-new island (dev regenerate) gets fresh shells.
    api.events.on('world:generated', scatter)
  },
})

/** Shells on sand cells near the water, deterministic per world seed. */
function scatterShells(api: PluginApi, cfg: Config, service: InventoryService): void {
  const w = api.world
  const blocks = api.registry('blocks')
  let seed = (w.seed ^ 0x5eed) >>> 0
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
  const spots: Array<[number, number, number]> = []
  for (let z = 2; z < w.sizeZ - 2; z++) {
    for (let x = 2; x < w.sizeX - 2; x++) {
      const y = w.surfaceY(x, z)
      // dry sand only: sand on top and nothing (no water) above it
      if (y <= 0 || w.getBlock(x, y - 1, z) !== 'core:sand' || w.getBlock(x, y, z) !== w.AIR) continue
      let nearWater = false
      for (let dz = -2; dz <= 2 && !nearWater; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          // water surfaces sit a little below the beach: look a few cells down
          for (let dy = 1; dy <= 3 && !nearWater; dy++) {
            if (blocks.isTagged(w.getBlock(x + dx, y - dy, z + dz), '#core:liquid')) nearWater = true
          }
          if (nearWater) break
        }
      }
      if (nearWater) spots.push([x, y, z])
    }
  }
  for (let i = 0; i < cfg.shells && spots.length; i++) {
    const [x, y, z] = spots.splice(Math.floor(rand() * spots.length), 1)[0]!
    service.spawnDrop('core:shell', 1, x + 0.5, y, z + 0.5)
  }
}

// --- components ---------------------------------------------------------------------------

type Props = { api: PluginApi; service: InventoryService; owner: () => Entity | undefined }

function HeldHud({ api, service, owner }: Props) {
  service.version.value // re-render on changes
  const a = owner()
  const id = a ? service.held(a) : null
  const name = id ? (api.registry('items').get(id)?.name ?? id) : 'Руки свободны'
  return (
    <ui.Pill>
      {id ? <ui.AsyncIcon src={api.ui.itemIcon(id)} size={30} /> : <span style={{ fontSize: '20px' }}>✋</span>}
      <span>{name}</span>
      <span style={{ display: 'inline-flex', gap: '4px', marginLeft: '6px' }}>
        <ui.Key>{api.input.keyLabel('items:cycleTool')}</ui.Key>
        <ui.Key>{api.input.keyLabel('items:pockets')}</ui.Key>
      </span>
    </ui.Pill>
  )
}

function Pockets({ api, service, owner, selected }: Props & { selected: Signal<number | null> }) {
  service.version.value
  const a = owner()
  const inv = a?.inventory
  if (!a || !inv) return <div>Нет карманов.</div>
  const items = api.registry('items')
  const sel = selected.value
  const selStack = sel !== null ? inv.slots[sel] : null
  const def = selStack ? items.get(selStack.id) : undefined
  const click = (i: number) => {
    if (sel === null) selected.value = inv.slots[i] ? i : null
    else if (sel === i) selected.value = null
    else {
      moveSlot(inv, sel, i, (id) => items.get(id)?.stack ?? 10)
      selected.value = null
      service.equip(a, inv.equipped)
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <ui.Grid columns={5}>
        {inv.slots.map((s, i) => (
          <ui.ItemSlot
            key={i}
            icon={s ? api.ui.itemIcon(s.id) : undefined}
            count={s?.count}
            title={s ? items.get(s.id)?.name : undefined}
            selected={sel === i}
            equipped={inv.equipped === i}
            onClick={() => click(i)}
            onContextMenu={() => s && service.equip(a, inv.equipped === i ? null : i)}
          />
        ))}
      </ui.Grid>
      <div style={{ minHeight: '64px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        {selStack && def ? (
          <>
            <div>
              <div style={{ fontWeight: 800, fontSize: '16px' }}>
                {def.name}
                {selStack.count > 1 ? ` ×${selStack.count}` : ''}
              </div>
              <div style={{ color: 'var(--ui-text-soft)', fontSize: '13px', maxWidth: '260px' }}>{def.description ?? ' '}</div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <ui.Button onClick={() => service.equip(a, inv.equipped === sel ? null : sel)}>
                {inv.equipped === sel ? 'Убрать из рук' : 'В руки'}
              </ui.Button>
              <ui.Button
                secondary
                onClick={() => {
                  service.drop(a, sel!)
                  selected.value = null
                  api.ui.close()
                }}
              >
                Выбросить
              </ui.Button>
            </div>
          </>
        ) : (
          <div style={{ color: 'var(--ui-text-soft)', fontSize: '13px', maxWidth: '340px' }}>
            Нажмите на предмет, чтобы выбрать; на другую ячейку — чтобы переложить. Правый клик — взять в руки.
          </div>
        )}
      </div>
    </div>
  )
}
