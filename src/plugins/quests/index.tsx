/**
 * Quests: five tasks every day, leaf points 🍃 for doing them, achievements, rewards bought with
 * points, the island rating and island projects. It all lives on the island board near the plaza.
 * Tasks, achievements, rewards and projects are data (content/quests/*.json5); what counts for a
 * task is a tracker fed by game events (catching, watering, selling, talking…).
 */
import { definePlugin, signal, ui, z, type Entity, type RegistryEntry, type Signal } from '@sdk'
import { Board } from './board'
import { advance, pickTasks, rate, tierOf, type DailyTask, type Rating, type TaskTemplate } from './logic'

export interface TaskDef extends TaskTemplate, RegistryEntry {}
export interface AchievementDef extends RegistryEntry {
  name: string
  text: string
  stat: string
  tiers: number[]
  points: number[]
  icon: string
}
export interface RewardDef extends RegistryEntry {
  item: string
  count: number
  bells?: number
  cost: number
}
export interface ProjectDef extends RegistryEntry {
  name: string
  description: string
  stars: number
  bells: number
  items: Array<{ item: string; count: number }>
  build: 'fountain' | 'pier'
}

export interface QuestState {
  day: number
  tasks: DailyTask[]
  talked: string[]
  bonus: boolean
  points: number
  stats: Record<string, number>
  achievements: Record<string, number>
  projects: Record<string, { state: 'funded' | 'built'; day: number }>
}

/** A milestone track: an achievement's tiers and how far along it is. */
export interface Milestone {
  id: string
  name: string
  text: string
  icon: string
  /** Stat thresholds of the tiers. */
  tiers: number[]
  /** Leaf points each tier gives. */
  points: number[]
  /** Tiers reached. */
  tier: number
  /** The stat now. */
  value: number
}

export interface QuestProgress {
  /** Leaf points to spend (live). */
  readonly points: Signal<number>
  /** Every achievement as a milestone track. */
  milestones(): Milestone[]
}

declare module '@sdk' {
  interface Services {
    'quests:progress': QuestProgress
  }
  interface Components {
    questBoard?: Record<string, never>
    fountain?: Record<string, never>
  }
  interface Registries {
    'quests:tasks': TaskDef
    'quests:achievements': AchievementDef
    'quests:rewards': RewardDef
    'quests:projects': ProjectDef
  }
}

const Config = z.object({
  /** Where the board stands, from the island middle (cells) — off the spot where the player arrives. */
  boardX: z.number().int().min(-20).max(20).default(-5).meta({ label: 'board x', step: 1 }),
  boardZ: z.number().int().min(-20).max(20).default(3).meta({ label: 'board z', step: 1 }),
  daily: z.number().int().min(1).max(10).default(5).meta({ label: 'tasks per day', step: 1 }),
  /** Bonus for finishing every task of the day. */
  bonus: z.number().int().min(0).max(2000).default(150).meta({ step: 10 }),
  pierLength: z.number().int().min(2).max(12).default(6).meta({ label: 'pier length', step: 1 }),
})
export type QuestsConfig = z.infer<typeof Config>

export default definePlugin({
  id: 'quests',
  version: '0.1.0',
  description: 'Задания дня, листики, достижения, рейтинг острова и проекты',
  dependsOn: ['items'],
  optionalDependsOn: ['collection', 'economy', 'crafting', 'villagers', 'museum', 'shop', 'house', 'decor', 'landscaping', 'terrain', 'daily', 'tutorial'],

  setup(api) {
    const cfg = api.config.define(Config)
    const tasks = api.createRegistry<TaskDef>(
      'quests:tasks',
      z.looseObject({
        id: z.string(),
        text: z.string(),
        track: z.string(),
        params: z.record(z.string(), z.unknown()).optional(),
        count: z.tuple([z.number().int(), z.number().int()]),
        step: z.number().int().min(1).optional(),
        points: z.number().int().min(0),
        weight: z.number().min(0).default(1),
      }) as never,
    )
    const achievements = api.createRegistry<AchievementDef>(
      'quests:achievements',
      z.looseObject({
        id: z.string(),
        name: z.string(),
        text: z.string(),
        stat: z.string(),
        tiers: z.array(z.number()),
        points: z.array(z.number()),
        icon: z.string().default('⭐'),
      }) as never,
    )
    const rewards = api.createRegistry<RewardDef>(
      'quests:rewards',
      z.looseObject({
        id: z.string(),
        item: z.string().default(''),
        count: z.number().int().min(1).default(1),
        bells: z.number().int().optional(),
        cost: z.number().int().min(0),
      }) as never,
    )
    const projects = api.createRegistry<ProjectDef>(
      'quests:projects',
      z.looseObject({
        id: z.string(),
        name: z.string(),
        description: z.string().default(''),
        stars: z.number().int().min(1).max(5),
        bells: z.number().int().min(0),
        items: z.array(z.object({ item: z.string(), count: z.number().int().min(1) })).default([]),
        build: z.enum(['fountain', 'pier']),
      }) as never,
    )
    api.components.define('questBoard', z.object({}))
    api.components.define('fountain', z.object({}))

    const fresh = (): QuestState => ({ day: -1, tasks: [], talked: [], bonus: false, points: 0, stats: {}, achievements: {}, projects: {} })
    const state: Signal<QuestState> = signal(fresh())
    const touch = () => (state.value = { ...state.value })
    api.save.register<QuestState>({ version: 1, save: () => state.value, load: (d) => (state.value = { ...fresh(), ...d }) })

    const roll = () => {
      const day = api.time.dayIndex
      if (state.value.day === day) return
      state.value.day = day
      state.value.tasks = pickTasks(tasks.all(), cfg.daily, api.world.seed, day)
      state.value.talked = []
      state.value.bonus = false
      touch()
    }
    api.events.on('session:started', roll)
    api.events.on('time:day', roll)

    const jingle = () =>
      [72, 76, 79].forEach((m, i) =>
        api.audio.note({ wave: 'triangle', freq: 440 * 2 ** ((m - 69) / 12), duration: 0.14, gain: 0.1, at: i * 0.08, bus: 'sfx' }),
      )
    const addPoints = (n: number) => {
      state.value.points += n
      touch()
    }

    // --- tracking ------------------------------------------------------------------------------------
    const bump = (track: string, amount: number, match: (params: Record<string, unknown>) => boolean = () => true) => {
      roll()
      for (const t of state.value.tasks) {
        const def = tasks.get(t.id)
        if (!def || def.track !== track || !match(def.params ?? {})) continue
        if (advance(t, amount)) {
          state.value.stats.tasks = (state.value.stats.tasks ?? 0) + 1
          addPoints(def.points)
          jingle()
          api.ui.toast(`Задание выполнено: ${def.text.replace('{count}', String(t.goal))} +${def.points} 🍃`, { ms: 3200 })
          checkAchievements()
          if (!state.value.bonus && state.value.tasks.every((x) => x.done)) {
            state.value.bonus = true
            addPoints(cfg.bonus)
            api.ui.toast(`Все задания дня выполнены! Бонус +${cfg.bonus} 🍃`, { ms: 3600 })
          }
        }
      }
      touch()
    }
    const stat = (key: string, by = 1) => {
      state.value.stats[key] = (state.value.stats[key] ?? 0) + by
      checkAchievements()
      touch()
    }
    const checkAchievements = () => {
      for (const a of achievements.all()) {
        const have = state.value.achievements[a.id] ?? 0
        const tier = tierOf(state.value.stats[a.stat] ?? 0, a.tiers)
        if (tier <= have) continue
        let pts = 0
        for (let i = have; i < tier; i++) pts += a.points[i] ?? 0
        state.value.achievements[a.id] = tier
        state.value.points += pts
        api.ui.toast(`${a.icon} Достижение «${a.name}» — ступень ${tier}! +${pts} 🍃`, { ms: 3600 })
      }
    }
    const points = signal(0)
    api.systems.add({ id: 'points', phase: 'postUpdate', run: () => void (points.value = state.value.points) })
    api.services.provide('quests:progress', {
      points,
      milestones: () =>
        achievements.all().map((a) => ({
          id: a.id,
          name: a.name,
          text: a.text,
          icon: a.icon,
          tiers: a.tiers,
          points: a.points,
          tier: state.value.achievements[a.id] ?? 0,
          value: state.value.stats[a.stat] ?? 0,
        })),
    })
    const isPlayer = (e: Entity) => !!e.player
    const items = api.registry('items')
    api.events.on('collection:caught', ({ actor, id }) => {
      if (!isPlayer(actor)) return
      const kind = api.services.has('collection:catalog') ? api.services.get('collection:catalog').get(id)?.kind : undefined
      bump('catch', 1, (p) => !p.kind || p.kind === kind)
      if (kind === 'fish') stat('fish')
      if (kind === 'bug') stat('bugs')
    })
    const STATS: Record<string, string> = { 'garden:water': 'watered', 'nature:shake': 'shaken', 'decor:place': 'decor_placed', 'landscaping:pave': 'paved' }
    api.events.on('interaction:performed', ({ id, ctx }) => {
      if (!isPlayer(ctx.actor)) return
      bump('interact', 1, (p) => Array.isArray(p.ids) && p.ids.includes(id))
      if (id === 'decor:place') bump('place', 1)
      if (id === 'landscaping:pave') bump('pave', 1)
      if (STATS[id]) stat(STATS[id]!)
    })
    api.events.on(
      'items:picked',
      ({ actor, id, count }) => isPlayer(actor) && bump('pick', count, (p) => typeof p.tag === 'string' && items.isTagged(id, p.tag)),
    )
    api.events.on('economy:sold', ({ bells }) => {
      bump('sell', bells)
      stat('bells_earned', bells)
    })
    api.events.on('crafting:crafted', () => {
      bump('craft', 1)
      stat('crafted')
    })
    api.events.on('villagers:talked', ({ id }) => {
      stat('talks')
      roll()
      if (state.value.talked.includes(id)) return
      state.value.talked = [...state.value.talked, id]
      bump('talk', 1)
    })
    api.events.on('villagers:gifted', () => (bump('gift', 1), stat('gifts')))
    api.events.on('villagers:helped', () => (bump('help', 1), stat('helped')))
    api.events.on('museum:donated', () => (bump('donate', 1), stat('donations')))
    api.events.on('shop:bought', () => bump('buy', 1))

    // --- the island board ------------------------------------------------------------------------------
    const boards = () => [...api.entities.world.with('questBoard', 'transform')]
    const placeBoard = () => {
      if (!api.services.has('decor:pieces')) return null
      const decor = api.services.get('decor:pieces')
      const cx = Math.floor(api.world.sizeX / 2) + cfg.boardX
      const cz = Math.floor(api.world.sizeZ / 2) + cfg.boardZ
      for (let r = 0; r < 30; r++)
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
            const x = cx + dx
            const z = cz + dz
            const y = decor.freeCell(x, z)
            if (y === null || decor.freeCell(x, z + 1) === null || decor.freeCell(x, z - 1) === null) continue
            return api.entities.spawn({
              name: 'Доска острова',
              transform: { x: x + 0.5, y, z: z + 0.5, rotY: 0 },
              model: { shape: 'voxel', ref: 'quests:board', size: [1, 2, 1], color: '#b07a50', anchor: 'bottom' },
              blocker: { w: 1, d: 1, h: 2 },
              blobShadow: { radius: 0.5, opacity: 0.2 },
              questBoard: {},
            })
          }
      return null
    }
    api.events.on('session:started', () => {
      if (!boards().length && !placeBoard()) api.log.warn('no place for the island board')
    })
    api.registry('interactions').register({
      id: 'quests:board',
      entity: 'questBoard',
      priority: 50,
      anim: 'none',
      sound: 'ui:open',
      label: 'Доска острова',
      run: () => void api.ui.open('quests:board'),
    })
    try {
      api.registry('tutorial:steps').register({
        id: 'quests:tutorial_board',
        order: 92,
        day: 3,
        text: 'Загляните на доску острова: задания дня приносят листики.',
        keys: ['player:use'],
        event: 'ui:opened',
        when: (p: { id: string }) => p.id === 'quests:board',
      })
    } catch {
      // no tutorial
    }

    api.ui.slot(
      'hud.topRight',
      () => (
        <ui.Quiet watch={state.value.points}>
          <Leaves state={state} />
        </ui.Quiet>
      ),
      { order: 21 },
    )

    // --- rating and projects -------------------------------------------------------------------------------
    const rating = (): Rating => {
      let paths = 0
      const blocks = api.registry('blocks')
      for (let z = 0; z < api.world.sizeZ; z++)
        for (let x = 0; x < api.world.sizeX; x++) {
          const y = api.world.surfaceY(x, z)
          if (y > 0 && blocks.isTagged(api.world.getBlock(x, y - 1, z), '#landscaping:paved')) paths++
        }
      const catalog = api.services.has('collection:catalog') ? api.services.get('collection:catalog') : null
      const museum = api.services.has('museum:donations') ? api.services.get('museum:donations') : null
      const total = catalog?.all().length ?? 0
      return rate({
        decor: [...api.entities.world.with('decor', 'transform')].filter((e) => !api.interiors.roomAt(e.transform.x, e.transform.z)).length,
        flowers: [...api.entities.world.with('flower')].length,
        trees: [...api.entities.world.with('tree')].length,
        paths,
        villagers: [...api.entities.world.with('villager')].length,
        museumShare: museum && total ? catalog!.all().filter((s) => museum.has(s.id)).length / total : 0,
        houseLevel: api.services.has('house:info') ? api.services.get('house:info').level() : 1,
        projects: Object.values(state.value.projects).filter((p) => p.state === 'built').length,
      })
    }
    const fund = (p: ProjectDef, actor: Entity): string | null => {
      if (state.value.projects[p.id]) return 'Уже в работе.'
      if (rating().stars < p.stars) return `Нужен рейтинг острова ${'★'.repeat(p.stars)}.`
      const inv = api.services.get('items:inventory')
      const wallet = api.services.has('economy:wallet') ? api.services.get('economy:wallet') : null
      if (!wallet || wallet.bells.value < p.bells) return 'Не хватает колокольчиков.'
      for (const it of p.items)
        if (inv.count(actor, it.item) < it.count) return `Нужно ещё: ${items.get(it.item)?.name ?? it.item} ×${it.count - inv.count(actor, it.item)}.`
      wallet.spend(p.bells)
      for (const it of p.items) inv.remove(actor, it.item, it.count)
      state.value.projects[p.id] = { state: 'funded', day: api.time.dayIndex + 1 }
      touch()
      return null
    }
    api.events.on('time:day', ({ dayIndex }) => {
      for (const [id, p] of Object.entries(state.value.projects)) {
        if (p.state !== 'funded' || dayIndex < p.day) continue
        const def = projects.get(id)
        if (def && build(def)) {
          p.state = 'built'
          api.ui.toast(`Построено: ${def.name}!`, { ms: 4000 })
        }
      }
      touch()
    })
    const build = (p: ProjectDef): boolean => (p.build === 'fountain' ? buildFountain() : buildPier())
    const buildFountain = () => {
      const cx = Math.floor(api.world.sizeX / 2)
      const cz = Math.floor(api.world.sizeZ / 2) + 6
      const decor = api.services.has('decor:pieces') ? api.services.get('decor:pieces') : null
      const free = (x: number, z: number, y: number) => (decor ? decor.freeCell(x, z) === y : api.world.surfaceY(x, z) === y)
      for (let r = 0; r < 30; r++)
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
            const x0 = cx + dx
            const z0 = cz + dz
            const y = decor?.freeCell(x0, z0) ?? null
            if (y === null) continue
            let ok = true
            for (let k = 0; k < 9 && ok; k++) ok = free(x0 + (k % 3), z0 + Math.floor(k / 3), y)
            if (!ok) continue
            api.entities.spawn({
              name: 'Фонтан',
              transform: { x: x0 + 1.5, y, z: z0 + 1.5, rotY: 0 },
              model: { shape: 'voxel', ref: 'quests:fountain', size: [3, 2, 3], color: '#d8d2c8', anchor: 'bottom' },
              blocker: { w: 3, d: 3, h: 2 },
              fountain: {},
            })
            return true
          }
      return false
    }
    const buildPier = () => {
      const water = api.services.has('terrain:water') ? api.services.get('terrain:water') : null
      if (!water) return false
      const cx = api.world.sizeX / 2
      const cz = api.world.sizeZ / 2
      let best: { x: number; z: number; dx: number; dz: number; y: number; d: number } | null = null
      for (let z = 2; z < api.world.sizeZ - 2; z++)
        for (let x = 2; x < api.world.sizeX - 2; x++) {
          const y = api.world.surfaceY(x, z)
          if (y <= 0 || api.world.getBlock(x, y - 1, z) !== 'core:sand' || water.kindAt(x, z)) continue
          for (const [dx, dz] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const) {
            // straight out to sea, two cells wide
            let ok = true
            for (let k = 1; k <= cfg.pierLength && ok; k++)
              ok = water.kindAt(x + dx * k, z + dz * k) === 'sea' && water.kindAt(x + dx * k + dz, z + dz * k + dx) === 'sea'
            const d = Math.hypot(x - cx, z - cz)
            if (ok && (!best || d < best.d)) best = { x, z, dx, dz, y, d }
          }
        }
      if (!best) return false
      const { x, z, dx, dz, y } = best
      for (let k = 1; k <= cfg.pierLength; k++)
        for (const side of [0, 1]) {
          const px = x + dx * k + dz * side
          const pz = z + dz * k + dx * side
          api.world.setBlock(px, y - 1, pz, 'core:planks')
          // posts down to the sea bed every other step, on the outer edge
          if (k % 2 === 0) for (let py = y - 2; py > 0 && !api.world.isSolid(px, py, pz); py--) api.world.setBlock(px, py, pz, 'core:planks')
        }
      return true
    }
    // a little sparkle over fountains near the player
    let sparkle = 0
    api.systems.add({
      id: 'fountain',
      outdoors: true, // the island waits while you're in a room
      phase: 'render',
      run: ({ dt }) => {
        if ((sparkle -= dt) > 0) return
        sparkle = 0.5
        for (const f of api.entities.world.with('fountain', 'transform'))
          api.fx.burst('core:splash', { x: f.transform.x, y: f.transform.y + 1.8, z: f.transform.z }, { amount: 0.35, scale: 0.6 })
      },
    })

    api.ui.window({
      id: 'quests:board',
      title: 'Доска острова',
      component: () => (
        <Board
          api={api}
          cfg={cfg}
          state={state}
          touch={touch}
          tasks={tasks}
          achievements={achievements}
          rewards={rewards}
          projects={projects}
          rating={rating}
          fund={fund}
          roll={roll}
        />
      ),
    })

    try {
      api.registry('daily:sections').register({
        id: 'quests:today',
        order: 15,
        line: () => {
          roll()
          const names = state.value.tasks.map((t) => tasks.get(t.id)?.text.replace('{count}', String(t.goal)).toLowerCase()).filter(Boolean)
          return names.length ? { icon: '📋', text: `Задания дня: ${names.join(', ')}. Подробности — на доске острова.` } : null
        },
      })
    } catch {
      // no daily notes
    }

    api.commands.register({
      name: 'quests',
      description: 'Задания: quests · quests points 500 · quests done (выполнить все) · quests build fountain|pier · quests rating',
      usage: '[points N | done | build id | rating]',
      run: ([what, n]) => {
        roll()
        if (what === 'points') addPoints(Number(n))
        if (what === 'rating') {
          const r = rating()
          return `${'★'.repeat(r.stars)} (${r.score})\n${r.tips.join('\n')}`
        }
        if (what === 'build') {
          const def = projects.get(n?.includes(':') ? n : `quests:${n}`)
          if (!def) throw new Error(`нет проекта "${n}": ${projects.ids().join(', ')}`)
          if (!build(def)) throw new Error('не нашлось места')
          state.value.projects[def.id] = { state: 'built', day: api.time.dayIndex }
          touch()
          return `построено: ${def.name}`
        }
        if (what === 'done') for (const t of state.value.tasks) bump(tasks.get(t.id)?.track ?? '', t.goal)
        return `${state.value.points} 🍃\n${state.value.tasks.map((t) => `${t.done ? '✓' : '·'} ${tasks.get(t.id)?.text.replace('{count}', String(t.goal))} (${t.progress}/${t.goal})`).join('\n')}`
      },
    })
  },
})

function Leaves({ state }: { state: Signal<QuestState> }) {
  const s = state.value
  const done = s.tasks.filter((t) => t.done).length
  return (
    <div class="cl-pill" title="Листики за задания дня">
      <span>🍃</span>
      <span>{s.points.toLocaleString('ru-RU')}</span>
      {s.tasks.length > 0 && (
        <span style={{ opacity: 0.6, fontSize: '12px' }}>
          · {done}/{s.tasks.length}
        </span>
      )}
    </div>
  )
}
