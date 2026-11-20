/**
 * The island museum: a building (5 × 5 cells) placed on flat grass near the middle of a new island.
 * Walk up to it and press the action key: three halls (fish, bugs, fossils) fill up with what you
 * donate. Unknown fossils dug from dig spots are identified here first.
 */
import { definePlugin, signal, ui, useState, z, type Entity, type PluginApi, type ReadonlySignal } from '@sdk'

declare module '@sdk' {
  interface Components {
    museum?: Record<string, never>
  }
  interface Services {
    'museum:donations': Donations
  }
}

export interface Donations {
  has(id: string): boolean
  readonly version: ReadonlySignal<number>
}

const Config = z.object({
  /** Footprint of the building (cells) — matches the model (40 voxels at 1/8). */
  width: z.number().int().min(1).max(12).default(5).meta({ step: 1 }),
  depth: z.number().int().min(1).max(12).default(5).meta({ step: 1 }),
  /** Free walkable rows kept in front of the door. */
  frontRows: z.number().int().min(1).max(6).default(2).meta({ label: 'front rows', step: 1 }),
  /** Chance that an identified fossil is one the museum doesn't have yet. */
  newFossilChance: z.number().min(0).max(1).default(0.7).meta({ label: 'new fossil chance', step: 0.05 }),
  /** Item that is identified into a fossil species. */
  unknownFossil: z.string().default('nature:fossil'),
})

const HALLS = [
  { kind: 'fish', title: 'Рыбы', icon: '🐟' },
  { kind: 'bug', title: 'Насекомые', icon: '🦋' },
  { kind: 'fossil', title: 'Окаменелости', icon: '🦴' },
] as const
type Kind = (typeof HALLS)[number]['kind']

export default definePlugin({
  id: 'museum',
  version: '0.1.0',
  description: 'Музей: залы рыб, насекомых и окаменелостей, пожертвования, оценка окаменелостей',
  dependsOn: ['items', 'collection'],
  // load after the plugins that put things on a new island, so the museum can clear its plot
  optionalDependsOn: ['nature', 'garden', 'terrain', 'tutorial'],

  setup(api) {
    const cfg = api.config.define(Config)
    const catalog = () => api.services.get('collection:catalog')
    const inventory = () => api.services.get('items:inventory')
    api.components.define('museum', z.object({}))
    const donated = new Map<string, number>() // id → day
    const version = signal(0)

    api.services.provide('museum:donations', { has: (id) => donated.has(id), version })
    api.save.register<Record<string, number>>({
      version: 1,
      save: () => Object.fromEntries(donated),
      load: (data) => {
        donated.clear()
        for (const [id, day] of Object.entries(data)) donated.set(id, day)
        version.value++
      },
    })

    // --- placing the building ------------------------------------------------------------------
    const museumEntity = () => {
      for (const e of api.entities.world.with('museum', 'transform')) return e
      return undefined
    }
    const grassTop = (x: number, z: number): number | null => {
      const y = api.world.surfaceY(x, z)
      if (y <= 0 || api.world.getBlock(x, y - 1, z) !== 'core:grass' || api.world.getBlock(x, y, z) !== api.world.AIR) return null
      return y
    }
    /** Can a 5×5 plot (+ rows in front) go at x0, z0? Returns the ground height. */
    const plotAt = (x0: number, z0: number): number | null => {
      const base = grassTop(x0, z0)
      if (base === null) return null
      for (let dz = 0; dz < cfg.depth + cfg.frontRows; dz++) {
        for (let dx = 0; dx < cfg.width; dx++) {
          const y = grassTop(x0 + dx, z0 + dz)
          if (y === null) return null
          // the building sits on level ground; the rows in front may step by one
          if (dz < cfg.depth ? y !== base : Math.abs(y - base) > 1) return null
        }
      }
      return base
    }
    const findPlot = (): { x0: number; z0: number; y: number } | null => {
      const cx = Math.floor(api.world.sizeX / 2 - cfg.width / 2)
      const cz = Math.floor(api.world.sizeZ / 2 - cfg.depth / 2)
      const maxR = Math.max(api.world.sizeX, api.world.sizeZ) / 2
      for (let r = 0; r < maxR; r++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue // ring by ring, nearest first
            const y = plotAt(cx + dx, cz + dz)
            if (y !== null) return { x0: cx + dx, z0: cz + dz, y }
          }
        }
      }
      return null
    }
    const place = () => {
      const plot = findPlot()
      if (!plot) {
        api.log.warn('no flat plot for the museum on this island')
        return null
      }
      const { x0, z0, y } = plot
      const inside = (x: number, z: number) => x >= x0 && x < x0 + cfg.width && z >= z0 && z < z0 + cfg.depth + cfg.frontRows
      for (const e of [...api.entities.world.with('transform')]) {
        if (!inside(Math.floor(e.transform.x), Math.floor(e.transform.z))) continue
        if (e.inventory || e.player) {
          // someone stands there: step out in front of the door
          e.transform.x = x0 + cfg.width / 2
          e.transform.z = z0 + cfg.depth + cfg.frontRows - 0.5
          continue
        }
        api.entities.despawn(e)
      }
      return api.entities.spawn({
        name: 'Музей',
        transform: { x: x0 + cfg.width / 2, y, z: z0 + cfg.depth / 2, rotY: 0 },
        model: { shape: 'voxel', ref: 'museum:building', size: [cfg.width, 5, cfg.depth], color: '#f7ecd6', anchor: 'bottom' },
        blocker: { w: cfg.width, d: cfg.depth, h: 6 },
        museum: {},
      })
    }
    api.events.on('session:started', () => {
      if (!museumEntity()) place()
    })

    // --- donating ------------------------------------------------------------------------------
    const jingle = () =>
      [67, 72, 76, 79].forEach((m, i) =>
        api.audio.note({ wave: 'sine', freq: 440 * 2 ** ((m - 69) / 12), duration: 0.22, gain: 0.1, at: i * 0.11, bus: 'sfx' }),
      )
    const celebrateAt = () => {
      const m = museumEntity()
      if (m) api.fx.burst('core:sparkle', { x: m.transform!.x, y: m.transform!.y + 3.2, z: m.transform!.z + 2.5 }, { amount: 2 })
    }
    const donate = (actor: Entity, id: string): boolean => {
      const s = catalog().get(id)
      if (!s || donated.has(id) || inventory().remove(actor, id, 1) < 1) return false
      donated.set(id, api.time.dayIndex)
      catalog().record(id)
      version.value++
      api.ui.toast(`Спасибо! «${s.name}» теперь в музее.`)
      jingle()
      celebrateAt()
      return true
    }
    /** Turn one unknown fossil into a specific species (prefers ones the museum lacks). */
    const identify = (actor: Entity): string | null => {
      if (inventory().remove(actor, cfg.unknownFossil, 1) < 1) return null
      const all = catalog().all('fossil')
      const missing = all.filter((s) => !donated.has(s.id) && !inventory().count(actor, s.id))
      const pool = missing.length && Math.random() < cfg.newFossilChance ? missing : all
      const pick = catalog().weighted(pool)
      if (!pick) return null
      inventory().add(actor, pick.id, 1, { quiet: true })
      catalog().record(pick.id)
      api.ui.toast(`Это… ${pick.name}!${donated.has(pick.id) ? ' Такой у музея уже есть.' : ''}`)
      api.audio.play('ui:pop')
      return pick.id
    }

    try {
      api.registry('tutorial:steps').register({
        id: 'museum:tutorial_visit',
        order: 80,
        text: 'Загляните в музей в центре острова и подарите ему находку.',
        keys: ['Space'],
        event: 'ui:opened',
        when: (p: { id: string }) => p.id === 'museum:hall',
      })
    } catch {
      // no tutorial plugin
    }

    api.registry('interactions').register({
      id: 'museum:enter',
      entity: 'museum',
      priority: 50,
      label: 'Зайти в музей',
      anim: 'none',
      sound: 'ui:open',
      run: () => void api.ui.open('museum:hall'),
    })
    api.ui.window({
      id: 'museum:hall',
      title: 'Музей острова',
      component: () => <Hall api={api} donated={donated} version={version} donate={donate} identify={identify} unknownFossil={cfg.unknownFossil} />,
    })

    api.commands.register({
      name: 'museum',
      description: 'Музей: museum (что подарено) · museum here (перенести к игроку) · museum place (заново найти место)',
      usage: '[here | place]',
      run: ([what]) => {
        if (what === 'place' || what === 'here') {
          const old = museumEntity()
          if (old) api.entities.despawn(old)
          const e = place()
          if (!e) return 'нет места'
          return `музей на ${Math.floor(e.transform!.x)}, ${Math.floor(e.transform!.z)}`
        }
        const counts = HALLS.map((h) => `${h.title}: ${catalog().all(h.kind).filter((s) => donated.has(s.id)).length}/${catalog().all(h.kind).length}`)
        const m = museumEntity()
        return `${counts.join(' · ')}\nздание: ${m ? `${Math.floor(m.transform!.x)}, ${Math.floor(m.transform!.z)}` : 'нет'}`
      },
    })
  },
})

// --- UI ----------------------------------------------------------------------------------------

function Hall(props: {
  api: PluginApi
  donated: Map<string, number>
  version: ReadonlySignal<number>
  donate: (actor: Entity, id: string) => boolean
  identify: (actor: Entity) => string | null
  unknownFossil: string
}) {
  const { api, donated } = props
  props.version.value
  const inv = api.services.get('items:inventory')
  inv.version.value
  const catalog = api.services.get('collection:catalog')
  const [tab, setTab] = useState<Kind | 'donate'>('donate')
  const actor = [...api.entities.world.with('player', 'transform')][0]

  const tabs = (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      <ui.Button secondary={tab !== 'donate'} onClick={() => setTab('donate')}>
        🎁 Подарить
      </ui.Button>
      {HALLS.map((h) => (
        <ui.Button key={h.kind} secondary={tab !== h.kind} onClick={() => setTab(h.kind)}>
          {h.icon} {h.title} {catalog.all(h.kind).filter((s) => donated.has(s.id)).length}/{catalog.all(h.kind).length}
        </ui.Button>
      ))}
    </div>
  )

  if (tab !== 'donate') {
    const list = catalog.all(tab)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: 'min(560px, 86vw)' }}>
        {tabs}
        <ui.Grid columns={7}>
          {list.map((s) =>
            donated.has(s.id) ? (
              <ui.ItemSlot key={s.id} icon={api.ui.itemIcon(s.id)} title={s.name} />
            ) : (
              <ui.ItemSlot key={s.id} title="Пустая витрина" />
            ),
          )}
        </ui.Grid>
        <div style={{ fontSize: '13px', color: 'var(--ui-text-soft)' }}>
          {list.every((s) => donated.has(s.id)) ? 'Зал полностью собран — какая красота!' : 'Пустые витрины ждут новых экспонатов.'}
        </div>
      </div>
    )
  }

  const pocket = actor ? (inv.of(actor)?.slots ?? []) : []
  const candidates = [...new Set(pocket.filter((s) => s && catalog.get(s.id) && !donated.has(s.id)).map((s) => s!.id))]
  const unknown = actor ? inv.count(actor, props.unknownFossil) : 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: 'min(560px, 86vw)' }}>
      {tabs}
      {unknown > 0 && actor && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <ui.ItemSlot icon={api.ui.itemIcon(props.unknownFossil)} count={unknown} />
          <div style={{ flex: 1, fontSize: '13px' }}>Неизвестные окаменелости: {unknown}. Смотритель определит, что это.</div>
          <ui.Button onClick={() => props.identify(actor)}>Оценить</ui.Button>
        </div>
      )}
      {candidates.length ? (
        <>
          <ui.Grid columns={7}>
            {candidates.map((id) => (
              <ui.ItemSlot key={id} icon={api.ui.itemIcon(id)} title={`Подарить: ${catalog.get(id)?.name}`} onClick={() => actor && props.donate(actor, id)} />
            ))}
          </ui.Grid>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', fontSize: '13px', color: 'var(--ui-text-soft)' }}>
            <span>Этого в музее ещё нет. Нажмите на экспонат, чтобы подарить.</span>
            <ui.Button onClick={() => actor && candidates.forEach((id) => props.donate(actor, id))}>Подарить всё</ui.Button>
          </div>
        </>
      ) : (
        <div style={{ fontSize: '13px', color: 'var(--ui-text-soft)', minHeight: '48px' }}>
          В карманах нет ничего нового для музея. Ловите рыбу и насекомых, копайте в местах с трещинками в земле.
        </div>
      )}
    </div>
  )
}
