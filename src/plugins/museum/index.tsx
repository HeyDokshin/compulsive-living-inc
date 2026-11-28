/**
 * The island museum: a building (5 × 5 cells) placed on flat grass near the middle of a new island.
 * Step inside (action key at the building) to walk around the hall: fish tanks, terrariums and
 * fossils fill their pedestals as you donate at the reception desk. Unknown fossils dug from dig
 * spots are identified there first. The hall itself is data (content/museum/museum.layouts.json5).
 */
import { definePlugin, signal, z, type Entity, type ReadonlySignal } from '@sdk'
import { Curator, type DialogueDef } from './curator'
import { HALL_ID, HallConfig, setupHall } from './interior'

declare module '@sdk' {
  interface Components {
    museum?: Record<string, never>
  }
  interface Services {
    'museum:donations': Donations
  }
  interface Registries {
    'museum:dialogue': DialogueDef
  }
  interface GameEvents {
    'museum:donated': { id: string; kind: string }
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
  hall: HallConfig,
  /** Curator's text: seconds per character, and the pitch of her babble (Hz). */
  typeSpeed: z.number().min(0.005).max(0.2).default(0.028).meta({ label: 'type speed (s)', step: 0.002 }),
  voicePitch: z.number().min(80).max(1200).default(330).meta({ label: 'voice pitch', step: 10 }),
})

const HALLS = [
  { kind: 'fish', title: 'Рыбы', icon: '🐟' },
  { kind: 'bug', title: 'Насекомые', icon: '🦋' },
  { kind: 'fossil', title: 'Окаменелости', icon: '🦴' },
] as const

export default definePlugin({
  id: 'museum',
  version: '0.1.0',
  description: 'Музей: залы рыб, насекомых и окаменелостей, пожертвования, оценка окаменелостей',
  dependsOn: ['items', 'collection', 'rooms'],
  // load after the plugins that put things on a new island, so the museum can clear its plot
  optionalDependsOn: ['nature', 'garden', 'terrain', 'tutorial', 'daily', 'cutscene'],

  setup(api) {
    api.interiors.define(HALL_ID, { name: 'Музей острова', icon: '🏛️' })
    const cfg = api.config.define(Config)
    const catalog = () => api.services.get('collection:catalog')
    const inventory = () => api.services.get('items:inventory')
    api.components.define('museum', z.object({}))
    const donated = new Map<string, number>() // id → day
    const version = signal(0)

    api.services.provide('museum:donations', { has: (id) => donated.has(id), version })
    const hall = setupHall(api, cfg.hall, { donated: (id) => donated.has(id), onDesk: () => void api.ui.open('museum:desk') })
    api.save.register<Record<string, number>>({
      version: 1,
      save: () => Object.fromEntries(donated),
      load: (data) => {
        donated.clear()
        for (const [id, day] of Object.entries(data)) donated.set(id, day)
        version.value++
        hall.refresh()
      },
    })

    // --- placing the building ------------------------------------------------------------------
    const museumEntity = () => {
      for (const e of api.entities.world.with('museum', 'transform')) return e
      return undefined
    }
    /** Grass on the ground level (buildings never go on raised land). */
    const grassTop = (x: number, z: number): number | null => {
      const y = api.world.surfaceY(x, z)
      if (y !== api.world.ground || api.world.getBlock(x, y - 1, z) !== 'core:grass' || api.world.getBlock(x, y, z) !== api.world.AIR) return null
      return y
    }
    /** Can a 5×5 plot (+ rows in front) go at x0, z0? Returns the ground height. */
    const plotAt = (x0: number, z0: number): number | null => {
      const base = grassTop(x0, z0)
      if (base === null) return null
      for (let dz = 0; dz < cfg.depth + cfg.frontRows; dz++) {
        for (let dx = 0; dx < cfg.width; dx++) {
          // the building and the rows in front all stand on the ground level
          if (grassTop(x0 + dx, z0 + dz) === null) return null
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
      if (api.interiors.current === HALL_ID) hall.build() // a save made inside the hall
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
      hall.refresh()
      api.events.emit('museum:donated', { id, kind: s.kind })
      jingle()
      celebrateAt()
      return true
    }
    /** Turn one unknown fossil into a specific species (prefers ones the museum lacks). */
    const identify = (actor: Entity): string | null => {
      const all = catalog().all('fossil')
      const missing = all.filter((s) => !donated.has(s.id) && !inventory().count(actor, s.id))
      const pool = missing.length && Math.random() < cfg.newFossilChance ? missing : all
      const pick = catalog().weighted(pool)
      if (!pick || inventory().remove(actor, cfg.unknownFossil, 1) < 1) return null
      const t = actor.transform!
      if (inventory().add(actor, pick.id, 1, { quiet: true }) > 0) inventory().spawnDrop(pick.id, 1, t.x, t.y, t.z) // pockets full
      catalog().record(pick.id)
      api.audio.play('ui:pop')
      return pick.id
    }

    try {
      api.registry('daily:sections').register({
        id: 'museum:today',
        order: 40,
        line: () => (museumEntity() ? { icon: '🏛', text: `В музее ${donated.size} из ${catalog().all().length} экспонатов.` } : null),
      })
    } catch {
      // no daily notes
    }
    try {
      api.registry('tutorial:steps').register({
        id: 'museum:tutorial_visit',
        order: 80,
        day: 2,
        text: 'Загляните в музей в центре острова: находки дарят у стойки.',
        keys: ['player:use'],
        event: 'interior:changed',
        when: (p: { id: string | null }) => p.id === HALL_ID,
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
      run: (ctx) => {
        const at = hall.entrance()
        if (!at) return false
        api.interiors.enter(HALL_ID, ctx.actor, at)
      },
    })
    // The curator: her lines are data; whether you've met is saved with the island.
    api.createRegistry<DialogueDef>('museum:dialogue', z.looseObject({ id: z.string(), lines: z.array(z.string()).min(1) }) as never)
    let met = false
    api.save.register<{ met: boolean }>({ version: 1, save: () => ({ met }), load: (d) => void (met = d.met) }, 'curator')
    // talking to Mira is a close-up of the two of you
    if (api.services.has('cutscene:talk')) api.services.get('cutscene:talk').conversation('museum:desk', () => hall.curator())
    api.ui.window({
      id: 'museum:desk',
      title: 'Музей острова',
      backdrop: 'clear',
      align: 'bottom', // like a conversation: the curator stays in view
      component: () => (
        <Curator
          deps={{
            api,
            met: () => met,
            meet: () => void (met = true),
            donated: (id) => donated.has(id),
            donatedCount: () => donated.size,
            donate,
            identify,
            unknownFossil: cfg.unknownFossil,
            setTalking: hall.setTalking,
            typeSpeed: cfg.typeSpeed,
            voicePitch: cfg.voicePitch,
          }}
        />
      ),
    })

    api.commands.register({
      name: 'museum',
      description: 'Музей: museum (что подарено) · museum place (заново найти место) · museum in / out (зайти, выйти) · museum all (подарить всё)',
      usage: '[place | in | out | all]',
      run: ([what]) => {
        const pl = [...api.entities.world.with('player', 'transform')][0]
        if (what === 'in' && pl) {
          const at = hall.entrance()
          if (at) api.interiors.enter(HALL_ID, pl, at)
          return 'внутри'
        }
        if (what === 'out' && pl) {
          api.interiors.exit(pl)
          return 'снаружи'
        }
        if (what === 'all') {
          for (const s of catalog().all()) donated.set(s.id, api.time.dayIndex)
          version.value++
          hall.refresh()
          return `подарено: ${donated.size}`
        }
        if (what === 'place') {
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
