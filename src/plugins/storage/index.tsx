/**
 * Chests: a decor piece (`decor:chest`, crafted at the workbench) that keeps things for you. Each chest
 * has its own slots, saved with it. A chest with things in it can't be picked up.
 */
import { definePlugin, signal, ui, z, type Entity, type PluginApi, type Signal } from '@sdk'
import { isEmpty, putInto, takeFrom, type Slot } from './slots'

declare module '@sdk' {
  interface Components {
    storage?: { slots: Slot[] }
  }
}

const Config = z.object({
  chestPiece: z.string().default('decor:chest'),
  slots: z.number().int().min(1).max(80).default(30).meta({ label: 'chest slots', step: 1 }),
  /** "Put everything away" leaves these in the pockets. */
  keepTags: z.array(z.string()).default(['#core:tools']),
})
type Config = z.infer<typeof Config>

export default definePlugin({
  id: 'storage',
  version: '0.1.0',
  description: 'Сундуки: хранить вещи, которые не влезают в карманы',
  dependsOn: ['items', 'decor'],

  setup(api) {
    const cfg = api.config.define(Config)
    api.components.define('storage', z.object({ slots: z.array(z.object({ id: z.string(), count: z.number().int().min(1) }).nullable()) }))
    const open = signal<Entity | null>(null)
    const version = signal(0)

    const slotsOf = (chest: Entity): Slot[] => {
      if (!chest.storage) api.entities.world.addComponent(chest, 'storage', { slots: Array.from({ length: cfg.slots }, () => null) })
      const s = chest.storage!.slots
      while (s.length < cfg.slots) s.push(null) // more slots configured since it was made
      return s
    }

    api.registry('interactions').register({
      id: 'storage:open',
      entity: 'decor',
      priority: 40,
      anim: 'none',
      sound: 'ui:open',
      label: 'Открыть сундук',
      when: (ctx) => ctx.target?.decor?.piece === cfg.chestPiece,
      run: (ctx) => {
        open.value = ctx.target!
        api.ui.open('storage:chest')
      },
    })
    // Things inside: the chest stays put.
    api.hooks.tap('decor:canTake', (ok, { entity }) => {
      if (!ok || entity.decor?.piece !== cfg.chestPiece || !entity.storage || isEmpty(entity.storage.slots)) return ok
      api.ui.toast('Сначала заберите вещи из сундука.')
      return false
    })
    // The open chest is the one the window shows; forget it when it goes away.
    api.events.on('ui:closed', ({ id }) => id === 'storage:chest' && (open.value = null))
    api.events.on('entity:despawned', ({ entity }) => entity === open.value && (open.value = null))

    api.ui.window({ id: 'storage:chest', title: 'Сундук', component: () => <Chest api={api} cfg={cfg} chest={open} slotsOf={slotsOf} version={version} /> })
  },
})

function Chest({ api, cfg, chest, slotsOf, version }: { api: PluginApi; cfg: Config; chest: Signal<Entity | null>; slotsOf: (e: Entity) => Slot[]; version: Signal<number> }) {
  const inv = api.services.get('items:inventory')
  inv.version.value
  version.value
  const items = api.registry('items')
  const actor = [...api.entities.world.with('player', 'transform')][0]
  const box = chest.value
  if (!actor || !box) return null
  const slots = slotsOf(box)
  const pocket = inv.of(actor)?.slots ?? []
  const stack = (id: string) => items.get(id)?.stack ?? 10
  const changed = () => void version.value++

  const store = (id: string, count: number) => {
    const taken = inv.remove(actor, id, count)
    const left = putInto(slots, id, taken, stack(id))
    if (left) inv.add(actor, id, left, { quiet: true }) // didn't fit: back to the pockets
    if (left === taken) api.ui.toast('Сундук полон.')
    api.audio.play('core:drop')
    changed()
  }
  const fetch = (i: number, count: number) => {
    const s = slots[i]
    if (!s) return
    const id = s.id
    const n = takeFrom(slots, i, count)
    const left = inv.add(actor, id, n, { quiet: true })
    if (left) putInto(slots, id, left, stack(id))
    if (left === n) api.ui.toast('Карманы полны.')
    api.audio.play('core:pickup')
    changed()
  }
  const storeAll = () => {
    const held = inv.held(actor)
    for (const s of [...pocket]) if (s && s.id !== held && !cfg.keepTags.some((t) => items.isTagged(s.id, t))) store(s.id, s.count)
  }
  const fetchAll = () => slots.forEach((s, i) => s && fetch(i, s.count))

  const grid = (list: readonly Slot[], onPick: (i: number, s: NonNullable<Slot>, one: boolean) => void) => (
    <ui.Grid columns={8}>
      {list.map((s, i) => (
        <ui.ItemSlot
          key={i}
          icon={s ? api.ui.itemIcon(s.id) : undefined}
          count={s?.count}
          title={s ? items.get(s.id)?.name : undefined}
          onClick={() => s && onPick(i, s, false)}
          onContextMenu={() => s && onPick(i, s, true)}
        />
      ))}
    </ui.Grid>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ fontWeight: 800, fontSize: '13px', color: 'var(--ui-text-soft)' }}>В сундуке</div>
      {grid(slots, (i, s, one) => fetch(i, one ? 1 : s.count))}
      <div style={{ fontWeight: 800, fontSize: '13px', color: 'var(--ui-text-soft)' }}>В карманах</div>
      {grid(pocket, (_, s, one) => store(s.id, one ? 1 : s.count))}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '12px', color: 'var(--ui-text-soft)' }}>Клик — переложить всё, правый клик — одну штуку.</span>
        <span style={{ display: 'flex', gap: '8px' }}>
          {isEmpty(slots) ? (
            <ui.Button secondary onClick={() => api.services.get('decor:pieces').take(actor, box) && api.ui.close()}>
              Унести сундук
            </ui.Button>
          ) : (
            <ui.Button secondary onClick={fetchAll}>
              Забрать всё
            </ui.Button>
          )}
          <ui.Button onClick={storeAll}>Положить всё</ui.Button>
        </span>
      </div>
    </div>
  )
}
