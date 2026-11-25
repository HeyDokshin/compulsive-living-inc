/**
 * Villagers: animal neighbours with characters. Who they are, how their day goes and what they say
 * are data (content/villagers/*.json5). They walk the island on the A* grid, sleep at home at night,
 * water flowers through the same interaction matrix the player uses, chat, take gifts, ask for
 * things, become friends (5 hearts → a photo), move in every few days and sometimes think about
 * moving away.
 */
import { definePlugin, findPath, signal, voiceBlip, z, type Cell, type Entity, type RegistryEntry, type Signal } from '@sdk'
import { Talk } from './talkUi'
import { activityAt, fill, hearts, MAX_POINTS, pickLine, type LineDef } from './talk'

export interface PersonalityDef extends RegistryEntry {
  name: string
  voice: number
  speed: number
  likes: string[]
  dislikes: string[]
  schedule: Array<[number, number, string]>
}

export interface VillagerDef extends RegistryEntry {
  name: string
  she: boolean
  animal: string
  head: string
  personality: string
  phrase: string
  colors: Record<string, string>
  house: Record<string, string>
}

export interface Resident {
  points: number
  met: boolean
  talkDay: number
  giftDay: number
  gifts: number
  request: { tag: string; label: string } | null
  requestDay: number
  photo: boolean
  since: number
  /** Day they move out (-1 = staying). */
  leaving: number
  /** Day they last came up to say hello. */
  hailDay?: number
}

export interface VillagerState {
  residents: Record<string, Resident>
  nextArrival: number
  /** Short news for the morning note: "X moved in", "Y moved out". */
  news: string[]
}

declare module '@sdk' {
  interface Components {
    villager?: { id: string }
    villagerHome?: { id: string }
  }
  interface Registries {
    'villagers:personalities': PersonalityDef
    'villagers:villagers': VillagerDef
    'villagers:lines': LineDef & RegistryEntry
  }
  interface GameEvents {
    'villagers:movedIn': { id: string }
    'villagers:movedOut': { id: string }
    'villagers:talked': { id: string }
    'villagers:gifted': { id: string; item: string; taste: string }
    'villagers:helped': { id: string; item: string }
  }
}

const Config = z.object({
  startResidents: z.number().int().min(0).max(8).default(3).meta({ label: 'start residents', step: 1 }),
  maxResidents: z.number().int().min(0).max(12).default(6).meta({ label: 'max residents', step: 1 }),
  /** A newcomer every this many days while there is room. */
  arrivalEvery: z.number().int().min(1).max(30).default(2).meta({ label: 'arrival every (days)', step: 1 }),
  /** Daily chance that a villager with few hearts thinks about moving. */
  leaveChance: z.number().min(0).max(1).default(0.12).meta({ label: 'leave chance', step: 0.01 }),
  walkSpeed: z.number().min(0.3).max(6).default(1.7).meta({ label: 'walk speed', step: 0.1 }),
  /** Nodes one path search may look at (paths are found one per tick). */
  pathNodes: z.number().int().min(100).max(20000).default(2500).meta({ label: 'path nodes', step: 100 }),
  talkPoints: z.number().int().min(0).max(20).default(2).meta({ label: 'talk points', step: 1 }),
  giftPoints: z.object({ love: z.number().default(8), like: z.number().default(4), neutral: z.number().default(2), dislike: z.number().default(-2) }).prefault({}),
  giftsPerDay: z.number().int().min(1).max(10).default(2).meta({ label: 'gifts per day', step: 1 }),
  requestChance: z.number().min(0).max(1).default(0.6).meta({ label: 'request chance', step: 0.05 }),
  requestPoints: z.number().int().min(0).max(30).default(6).meta({ label: 'request points', step: 1 }),
  requestBells: z.tuple([z.number().int(), z.number().int()]).default([300, 1200]),
  /** Things a villager may ask for: a tag and how they say it. */
  requests: z
    .array(z.object({ tag: z.string(), label: z.string() }))
    .default([
      { tag: '#collection:fish', label: 'любую рыбу' },
      { tag: '#collection:bugs', label: 'любое насекомое' },
      { tag: '#core:fruits', label: 'какой-нибудь фрукт' },
      { tag: '#garden:flowers', label: 'цветок' },
      { tag: '#core:materials', label: 'немного материалов' },
      { tag: '#core:beach_finds', label: 'что-нибудь с пляжа' },
    ]),
  /** Neighbours come up to say hello once a day: from this close (cells), not more often than every so many seconds. */
  hailRadius: z.number().min(0).max(20).default(8).meta({ label: 'hail radius', step: 0.5 }),
  hailEvery: z.number().min(1).max(600).default(35).meta({ label: 'hail every (s)', step: 1 }),
  /** Seconds between a neighbour's little emotes (average). */
  emoteEvery: z.number().min(3).max(600).default(26).meta({ label: 'emote every (s)', step: 1 }),
  /** Neighbours within this many cells answer the player's emotes. */
  emoteRadius: z.number().min(0).max(20).default(6).meta({ label: 'answer radius', step: 0.5 }),
  /** Blocks between footsteps and how loud they are (next to the player's). */
  stride: z.number().min(0.2).max(3).default(0.9).meta({ step: 0.05 }),
  stepVolume: z.number().min(0).max(1).default(0.35).meta({ label: 'step volume', step: 0.05 }),
  /** What villagers call a player without a name. */
  playerName: z.string().default('сосед'),
  /** Watering can villagers carry (they water flowers through the interaction matrix). */
  tool: z.string().default('core:watering_can'),
})
export type VillagersConfig = z.infer<typeof Config>

interface Brain {
  path: Cell[]
  wait: number
  activity: string
  /** What to do on arrival: water a flower at, face a point. */
  water?: { x: number; z: number }
  face?: { x: number; z: number }
  asleep: boolean
  /** On the way to say hello to the player. */
  hail?: boolean
  emoteIn: number
  steps: number
}

export default definePlugin({
  id: 'villagers',
  version: '0.1.0',
  description: 'Жители: характеры, распорядок, диалоги, дружба, подарки, просьбы, переезды',
  dependsOn: ['items', 'characters'],
  // homes go up after the big buildings; photos are decor pieces
  optionalDependsOn: ['decor', 'museum', 'shop', 'house', 'economy', 'garden', 'terrain', 'weather', 'daily', 'tutorial', 'emotes'],

  setup(api) {
    const cfg = api.config.define(Config)
    const personalities = api.createRegistry<PersonalityDef>(
      'villagers:personalities',
      z.looseObject({
        id: z.string(),
        name: z.string(),
        voice: z.number().default(320),
        speed: z.number().default(0.028),
        likes: z.array(z.string()).default([]),
        dislikes: z.array(z.string()).default([]),
        schedule: z.array(z.tuple([z.number(), z.number(), z.string()])).default([]),
      }) as never,
    )
    const defs = api.createRegistry<VillagerDef>(
      'villagers:villagers',
      z.looseObject({
        id: z.string(),
        name: z.string(),
        she: z.boolean().default(false),
        animal: z.string(),
        head: z.string(),
        personality: z.string(),
        phrase: z.string(),
        colors: z.record(z.string(), z.string()).default({}),
        house: z.record(z.string(), z.string()).default({}),
      }) as never,
    )
    const lines = api.createRegistry<LineDef & RegistryEntry>(
      'villagers:lines',
      z.looseObject({
        id: z.string(),
        topic: z.string(),
        personality: z.string().optional(),
        when: z
          .object({
            hours: z.tuple([z.number(), z.number()]).optional(),
            weather: z.enum(['rain', 'dry']).optional(),
            minHearts: z.number().optional(),
            maxHearts: z.number().optional(),
            seasons: z.array(z.string()).optional(),
          })
          .optional(),
        lines: z.array(z.string()).min(1),
      }) as never,
    )
    api.components.define('villager', z.object({ id: z.string() }))
    api.components.define('villagerHome', z.object({ id: z.string() }))

    const fresh = (): VillagerState => ({ residents: {}, nextArrival: -1, news: [] })
    const state: Signal<VillagerState> = signal(fresh())
    const touch = () => (state.value = { ...state.value })
    api.save.register<VillagerState>({ version: 1, save: () => state.value, load: (d) => (state.value = { ...fresh(), ...d }) })
    const resident = (id: string) => state.value.residents[id]

    // Photos: a decor piece per villager (given at 5 hearts).
    const photoId = (v: VillagerDef) => `villagers:photo_${v.id.split(':').pop()}`
    const registerPhotos = () => {
      if (!api.services.has('decor:pieces')) return
      const pieces = api.registry('decor:pieces')
      for (const v of defs.all()) {
        if (pieces.has(photoId(v))) continue
        pieces.register({
          id: photoId(v),
          name: `Фото: ${v.name}`,
          description: `${v.name} подарил${v.she ? 'а' : ''} на память.`,
          model: 'villagers:photo',
          price: 0,
          stack: 1,
          blocker: false,
          layer: 'top',
          surface: 0,
          indoor: false,
          variants: [{ id: 'default', name: '', palette: { s: v.colors.s ?? '#c99a70', b: v.house.q ?? '#a6d8f0' } }],
        })
      }
    }
    api.events.on('content:loaded', registerPhotos)
    registerPhotos()

    // --- homes and bodies ------------------------------------------------------------------------
    const npcs = api.entities.world.with('villager', 'transform')
    const homes = api.entities.world.with('villagerHome', 'transform')
    const npcOf = (id: string) => {
      for (const e of npcs) if (e.villager.id === id) return e
      return undefined
    }
    const homeOf = (id: string) => {
      for (const e of homes) if (e.villagerHome.id === id) return e
      return undefined
    }
    const door = (home: Entity) => ({ x: Math.floor(home.transform!.x), z: Math.floor(home.transform!.z) + 2 })

    const grass = (x: number, zz: number) => {
      const y = api.world.surfaceY(x, zz)
      return y > 0 && api.world.getBlock(x, y - 1, zz) === 'core:grass' && api.world.getBlock(x, y, zz) === api.world.AIR ? y : null
    }
    /** A flat 3 × 3 plot with a free row in front, away from other buildings and homes. */
    const plotAt = (x0: number, z0: number): number | null => {
      const base = grass(x0, z0)
      if (base === null) return null
      for (let dz = 0; dz < 4; dz++)
        for (let dx = 0; dx < 3; dx++) {
          const y = grass(x0 + dx, z0 + dz)
          if (y === null || (dz < 3 ? y !== base : Math.abs(y - base) > 1) || api.world.blockerAt(x0 + dx, z0 + dz)) return null
        }
      for (let dz = -3; dz < 7; dz++) for (let dx = -3; dx < 6; dx++) if ((api.world.blockerAt(x0 + dx, z0 + dz)?.blocker?.w ?? 1) > 1) return null
      for (const h of homes) if (Math.hypot(h.transform.x - (x0 + 1.5), h.transform.z - (z0 + 1.5)) < 8) return null
      return base
    }
    const placeHome = (v: VillagerDef): Entity | null => {
      const cx = Math.floor(api.world.sizeX / 2)
      const cz = Math.floor(api.world.sizeZ / 2)
      let seed = (api.world.seed ^ Math.imul(v.id.length * 977 + v.id.charCodeAt(v.id.length - 1), 0x9e3779b1)) >>> 0
      const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
      for (let tries = 0; tries < 900; tries++) {
        const a = rand() * Math.PI * 2
        const d = 10 + rand() * 34
        const x0 = Math.floor(cx + Math.cos(a) * d)
        const z0 = Math.floor(cz + Math.sin(a) * d)
        const y = plotAt(x0, z0)
        if (y === null) continue
        for (const e of [...api.entities.world.with('transform')]) {
          const ex = Math.floor(e.transform.x)
          const ez = Math.floor(e.transform.z)
          if (ex >= x0 && ex < x0 + 3 && ez >= z0 && ez < z0 + 4 && !e.inventory) api.entities.despawn(e)
        }
        return api.entities.spawn({
          name: `Дом: ${v.name}`,
          transform: { x: x0 + 1.5, y, z: z0 + 1.5, rotY: 0 },
          model: { shape: 'voxel', ref: 'villagers:house', palette: v.house, size: [3, 3, 3], color: '#f7ecd6', anchor: 'bottom' },
          blocker: { w: 3, d: 3, h: 4 },
          villagerHome: { id: v.id },
        })
      }
      return null
    }
    const spawnBody = (v: VillagerDef, home: Entity) => {
      const d = door(home)
      return api.entities.spawn({
        name: v.name,
        transform: { x: d.x + 0.5, y: api.world.surfaceY(d.x, d.z), z: d.z + 0.5, rotY: 0 },
        model: { shape: 'rig', ref: 'core:chibi', palette: v.colors, parts: { head: v.head }, size: [1, 1, 1], color: '#fff', anchor: 'bottom' },
        biped: { speed: 0 },
        blobShadow: { radius: 0.34, opacity: 0.3 },
        villager: { id: v.id },
        inventory: { slots: [{ id: cfg.tool, count: 1 }], equipped: 0 },
      })
    }
    const moveIn = (v: VillagerDef, quiet = false) => {
      const home = placeHome(v)
      if (!home) return false
      spawnBody(v, home)
      const day = api.time.dayIndex
      state.value.residents[v.id] = { points: 0, met: false, talkDay: -1, giftDay: -1, gifts: 0, request: null, requestDay: -1, photo: false, since: day, leaving: -1 }
      if (!quiet) {
        state.value.news = [...state.value.news, `К нам переехал${v.she ? 'а' : ''} ${v.name} (${v.animal})! Загляните познакомиться.`]
        api.ui.toast(`На остров переехал${v.she ? 'а' : ''} ${v.name}!`, { ms: 3500 })
      }
      touch()
      api.events.emit('villagers:movedIn', { id: v.id })
      return true
    }
    const moveOut = (id: string) => {
      const v = defs.get(id)
      const npc = npcOf(id)
      const home = homeOf(id)
      if (npc) api.entities.despawn(npc)
      if (home) api.entities.despawn(home)
      delete state.value.residents[id]
      if (v) state.value.news = [...state.value.news, `${v.name} переехал${v.she ? 'а' : ''} на другой остров. Будем скучать!`]
      touch()
      api.events.emit('villagers:movedOut', { id })
    }
    const newcomers = () => defs.all().filter((v) => !resident(v.id))

    api.events.on('session:started', () => {
      // a new island (or a save from before villagers): the first neighbours
      if (!Object.keys(state.value.residents).length && !api.save.hasData) {
        // the same neighbours for the same island: a seeded shuffle
        let seed = (api.world.seed ^ 0x5eed) >>> 0
        const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
        const pool = [...defs.all()].sort((a, b) => (a.id < b.id ? -1 : 1))
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1))
          ;[pool[i], pool[j]] = [pool[j]!, pool[i]!]
        }
        for (const v of pool.slice(0, cfg.startResidents)) moveIn(v, true)
        state.value.nextArrival = api.time.dayIndex + cfg.arrivalEvery
        touch()
      }
      // bodies or homes lost (content changed): put them back
      for (const id of Object.keys(state.value.residents)) {
        const v = defs.get(id)
        if (!v) continue
        const home = homeOf(id) ?? placeHome(v)
        if (home && !npcOf(id)) spawnBody(v, home)
      }
      brains.clear()
    })

    // Days go by: newcomers, leavers.
    api.events.on('time:day', ({ dayIndex }) => {
      const st = state.value
      for (const [id, r] of Object.entries(st.residents)) {
        if (r.leaving >= 0 && dayIndex >= r.leaving) moveOut(id)
        r.gifts = 0
      }
      const living = Object.entries(st.residents)
      if (living.length < cfg.maxResidents && st.nextArrival >= 0 && dayIndex >= st.nextArrival) {
        const v = newcomers()[Math.floor(Math.random() * newcomers().length)]
        if (v) moveIn(v)
        st.nextArrival = dayIndex + cfg.arrivalEvery
      }
      // someone who never really made friends may think about moving (one at a time)
      if (!living.some(([, r]) => r.leaving >= 0) && living.length > cfg.startResidents && Math.random() < cfg.leaveChance) {
        const lonely = living.filter(([, r]) => hearts(r.points) <= 1 && dayIndex - r.since >= 5)
        const pick = lonely[Math.floor(Math.random() * lonely.length)]
        if (pick) pick[1].leaving = dayIndex + 2
      }
      touch()
    })

    // --- walking and the daily routine ------------------------------------------------------------
    const brains = new Map<Entity, Brain>()
    const blocks = api.registry('blocks')
    const liquid = (x: number, y: number, zz: number) => blocks.isTagged(api.world.getBlock(x, y, zz), '#core:liquid')
    const standY = (x: number, zz: number): number | null => {
      if (x < 1 || zz < 1 || x >= api.world.sizeX - 1 || zz >= api.world.sizeZ - 1) return null
      if (api.interiors.roomAt(x + 0.5, zz + 0.5)) return null
      const y = api.world.surfaceY(x, zz)
      if (y <= 0 || liquid(x, y - 1, zz) || liquid(x, y, zz)) return null
      if (api.world.isSolid(x, y, zz) || api.world.isSolid(x, y + 1, zz)) return null
      if (api.hooks.run('movement:blocked', false, { x, y, z: zz })) return null
      return y
    }
    const canStep = (a: Cell, b: Cell) => {
      const ya = standY(a.x, a.z) ?? api.world.surfaceY(a.x, a.z)
      const yb = standY(b.x, b.z)
      return yb !== null && Math.abs(yb - ya) <= 1
    }
    let searchesThisTick = 0
    const pathTo = (from: Entity, goal: Cell, near = false): Cell[] | null => {
      if (searchesThisTick++ > 0) return null // one search per tick across all villagers
      const start = { x: Math.floor(from.transform!.x), z: Math.floor(from.transform!.z) }
      const adjacent = (c: Cell) => Math.abs(c.x - goal.x) <= 1 && Math.abs(c.z - goal.z) <= 1 && (c.x !== goal.x || c.z !== goal.z)
      return findPath(start, { canStep, isGoal: near ? adjacent : (c) => c.x === goal.x && c.z === goal.z, target: goal, maxNodes: cfg.pathNodes })
    }
    const randomNear = (cx: number, cz: number, r: number): Cell | null => {
      for (let i = 0; i < 12; i++) {
        const x = Math.floor(cx + (Math.random() * 2 - 1) * r)
        const zz = Math.floor(cz + (Math.random() * 2 - 1) * r)
        if (standY(x, zz) !== null) return { x, z: zz }
      }
      return null
    }
    const landmarks = () => [...api.entities.world.with('blocker', 'transform')].filter((e) => (e.blocker.w ?? 1) > 1 && !e.villagerHome)
    const planNext = (npc: Entity, b: Brain, home: Entity) => {
      const t = npc.transform!
      b.water = undefined
      b.face = undefined
      const d = door(home)
      switch (b.activity) {
        case 'sleep': {
          if (Math.floor(t.x) === d.x && Math.floor(t.z) === d.z) {
            // inside the house: hidden by its walls
            b.asleep = true
            t.x = home.transform!.x
            t.z = home.transform!.z
            return
          }
          b.path = pathTo(npc, d) ?? []
          return
        }
        case 'garden': {
          let best: Entity | null = null
          let bestD = 14
          for (const f of api.entities.world.with('flower', 'transform')) {
            const dd = Math.hypot(f.transform.x - t.x, f.transform.z - t.z) + (f.flower.watered === api.time.dayIndex ? 8 : 0)
            if (dd < bestD) (best = f), (bestD = dd)
          }
          if (best) {
            const fc = { x: Math.floor(best.transform!.x), z: Math.floor(best.transform!.z) }
            const p = pathTo(npc, fc, true)
            if (p) {
              b.path = p
              b.water = fc
              return
            }
          }
          break
        }
        case 'plaza': {
          const c = randomNear(api.world.sizeX / 2, api.world.sizeZ / 2 + 6, 6)
          if (c) b.path = pathTo(npc, c) ?? []
          return
        }
        case 'visit': {
          const all = landmarks()
          const lm = all[Math.floor(Math.random() * all.length)]
          if (lm) {
            const front = { x: Math.floor(lm.transform!.x), z: Math.floor(lm.transform!.z + (lm.blocker!.d ?? 1) / 2 + 1) }
            const c = randomNear(front.x + 0.5, front.z + 0.5, 1.5) ?? front
            b.path = pathTo(npc, c) ?? []
            b.face = { x: lm.transform!.x, z: lm.transform!.z }
            return
          }
          break
        }
        case 'shore': {
          const water = api.services.has('terrain:water') ? api.services.get('terrain:water') : null
          if (!water) break
          for (let i = 0; i < 20; i++) {
            const c = randomNear(t.x, t.z, 14)
            if (!c) continue
            const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dz]) => water.kindAt(c.x + dx!, c.z + dz!))
            if (!wet) continue
            b.path = pathTo(npc, c) ?? []
            b.face = { x: c.x + wet[0]! + 0.5, z: c.z + wet[1]! + 0.5 }
            return
          }
          break
        }
      }
      const c = randomNear(d.x + 0.5, d.z + 2.5, 6)
      if (c) b.path = pathTo(npc, c) ?? []
    }

    let talkingTo: Entity | null = null
    let hailIn = 4
    const emotes = () => (api.services.has('emotes:show') ? api.services.get('emotes:show') : null)
    const raining = () => (api.services.has('weather:forecast') ? api.services.get('weather:forecast').current()?.precipitation === 'rain' : false)
    /** A line for a moment outside a conversation. */
    const line = (v: VillagerDef, r: Resident, topic: string) => {
      const text = pickLine(lines.all(), topic, { personality: v.personality, hour: api.time.hour, raining: raining(), hearts: hearts(r.points), season: api.time.season }, Math.random)
      return fill(text ?? '', { name: v.name, phrase: v.phrase, animal: v.animal, player: api.session.player || cfg.playerName, a: v.she ? 'а' : '' })
    }
    const moodOf = (b: Brain): string => {
      if (raining() && Math.random() < 0.6) return 'emotes:rain'
      if (api.time.season === 'winter' && Math.random() < 0.3) return 'emotes:cold'
      if (b.activity === 'garden') return 'emotes:flower'
      return ['emotes:note', 'emotes:joy', 'emotes:idea', 'emotes:note'][Math.floor(Math.random() * 4)]!
    }
    // Neighbours who see the player's emote turn and answer a moment later.
    const answers: Array<{ npc: Entity; id: string; in: number }> = []
    api.events.on('emotes:shown', ({ entity, id }) => {
      const reply = entity.player && api.services.has('emotes:show') ? api.registry('emotes:emotes').get(id)?.reply : undefined
      if (!reply?.length) return
      for (const npc of npcs) {
        const b = brains.get(npc)
        if (!b || b.asleep || Math.hypot(npc.transform.x - entity.transform!.x, npc.transform.z - entity.transform!.z) > cfg.emoteRadius) continue
        npc.transform.rotY = Math.atan2(entity.transform!.x - npc.transform.x, entity.transform!.z - npc.transform.z)
        b.path = []
        b.wait = 2.5
        b.hail = false
        answers.push({ npc, id: reply[Math.floor(Math.random() * reply.length)]!, in: 0.5 + Math.random() * 0.7 })
      }
    })
    api.systems.add({
      id: 'answers',
      phase: 'update',
      run: ({ dt }) => {
        for (let i = answers.length - 1; i >= 0; i--) {
          const a = answers[i]!
          if ((a.in -= dt) > 0) continue
          answers.splice(i, 1)
          if (api.entities.world.has(a.npc)) emotes()?.show(a.npc, a.id)
        }
      },
    })
    const player = () => {
      for (const e of api.entities.world.with('player', 'transform')) return e
      return undefined
    }
    api.systems.add({
      id: 'brains',
      phase: 'update',
      run: ({ dt }) => {
        searchesThisTick = 0
        hailIn -= dt
        const pl = player()
        const hour = api.time.hour
        for (const npc of npcs) {
          const v = defs.get(npc.villager.id)
          const home = homeOf(npc.villager.id)
          if (!v || !home) continue
          const pers = personalities.get(v.personality)
          let b = brains.get(npc)
          const t = npc.transform
          if (!b) {
            // in the house (a save made at night): asleep there until the morning wakes them
            const asleep = Math.abs(t.x - home.transform.x) < 1.5 && Math.abs(t.z - home.transform.z) < 1.5
            brains.set(npc, (b = { path: [], wait: Math.random() * 2, activity: asleep ? 'sleep' : '', asleep, emoteIn: Math.random() * cfg.emoteEvery, steps: 0 }))
          }
          const activity = activityAt(pers?.schedule ?? [], hour)
          if (activity !== b.activity) {
            b.activity = activity
            b.path = []
            b.wait = 0
            if (b.asleep && activity !== 'sleep') {
              // wake up: step out of the door
              const d = door(home)
              t.x = d.x + 0.5
              t.z = d.z + 0.5
              t.y = api.world.surfaceY(d.x, d.z)
              b.asleep = false
            }
          }
          if (b.asleep) {
            npc.biped!.speed = 0
            if ((b.emoteIn -= dt) <= 0) {
              b.emoteIn = cfg.emoteEvery * 0.3
              emotes()?.show(home, 'emotes:sleepy', { height: 3.4, silent: true })
            }
            continue
          }
          if ((b.emoteIn -= dt) <= 0) {
            b.emoteIn = cfg.emoteEvery * (0.5 + Math.random())
            if (!b.hail && talkingTo !== npc) emotes()?.show(npc, moodOf(b), { silent: !pl || Math.hypot(pl.transform.x - t.x, pl.transform.z - t.z) > 8 })
          }
          // a neighbour nearby who hasn't said hello today comes up
          if (pl && !b.hail && talkingTo !== npc && hailIn <= 0 && emotes() && !api.interiors.current) {
            const r = resident(npc.villager.id)
            const far = Math.hypot(pl.transform.x - t.x, pl.transform.z - t.z)
            if (r && r.hailDay !== api.time.dayIndex && far < cfg.hailRadius) {
              const p = far < 1.8 ? [] : pathTo(npc, { x: Math.floor(pl.transform.x), z: Math.floor(pl.transform.z) }, true)
              hailIn = p ? cfg.hailEvery : 2 // no way there: don't search again every tick
              if (p) {
                b.hail = true
                b.path = p
                b.wait = 0
                b.water = undefined
                emotes()?.show(npc, 'emotes:surprise', { silent: true, seconds: 0.9 })
              }
            }
          }
          // in a conversation: stand and look at the player
          if (talkingTo === npc && pl) {
            t.rotY = Math.atan2(pl.transform.x - t.x, pl.transform.z - t.z)
            npc.biped!.speed = 0
            continue
          }
          const next = b.path[0]
          if (!next) {
            npc.biped!.speed = 0
            if (b.hail) {
              b.hail = false
              b.wait = 4
              const r = resident(npc.villager.id)
              if (pl && r && Math.hypot(pl.transform.x - t.x, pl.transform.z - t.z) < 4) {
                t.rotY = Math.atan2(pl.transform.x - t.x, pl.transform.z - t.z)
                r.hailDay = api.time.dayIndex
                emotes()?.say(npc, line(v, r, 'hail'))
                npc.biped!.action = { name: 'wave', t: 0 }
                voiceBlip(api, pers?.voice ?? 320)
              }
              continue
            }
            if ((b.wait -= dt) > 0) continue
            if (b.water) {
              // water the flower through the interaction matrix, like the player would
              t.rotY = Math.atan2(b.water.x + 0.5 - t.x, b.water.z + 0.5 - t.z)
              const ctx = api.interactions.at(npc, b.water.x, b.water.z)
              const def = api.interactions.perform(ctx)
              if (def && npc.biped) npc.biped.action = { name: 'swing', t: 0 }
              b.water = undefined
              b.wait = 2 + Math.random() * 3
              continue
            }
            if (b.face) {
              t.rotY = Math.atan2(b.face.x - t.x, b.face.z - t.z)
              b.face = undefined
              b.wait = 4 + Math.random() * 8
              continue
            }
            planNext(npc, b, home)
            if (!b.path.length && !b.asleep) b.wait = 1 + Math.random() * 3
            continue
          }
          // walk to the next cell center; wait if the player is right there
          const tx = next.x + 0.5
          const tz = next.z + 0.5
          const dx = tx - t.x
          const dz = tz - t.z
          const dist = Math.hypot(dx, dz)
          if (pl && Math.hypot(pl.transform.x - tx, pl.transform.z - tz) < 0.6) {
            npc.biped!.speed = 0
            continue
          }
          const step = cfg.walkSpeed * dt
          if (dist <= step) {
            t.x = tx
            t.z = tz
            b.path.shift()
          } else {
            t.x += (dx / dist) * step
            t.z += (dz / dist) * step
          }
          const want = Math.atan2(dx, dz)
          const turn = Math.atan2(Math.sin(want - t.rotY), Math.cos(want - t.rotY))
          t.rotY += turn * Math.min(1, dt * 10)
          const gy = api.world.surfaceY(t.x, t.z)
          t.y += (gy - t.y) * Math.min(1, dt * 12)
          npc.biped!.speed = cfg.walkSpeed / 3.1
          if ((b.steps += step) >= cfg.stride) {
            b.steps = 0
            const sound = blocks.get(api.world.getBlock(Math.floor(t.x), Math.round(t.y) - 1, Math.floor(t.z)))?.sounds?.step
            if (sound) api.audio.play(sound, { at: t, volume: cfg.stepVolume })
          }
          if (!b.path.length) b.wait = 2 + Math.random() * 6
        }
      },
    })
    api.events.on('entity:despawned', ({ entity }) => brains.delete(entity))

    // --- talking -------------------------------------------------------------------------------------
    const talking = signal<Entity | null>(null)
    const interactions = api.registry('interactions')
    interactions.register({
      id: 'villagers:talk',
      entity: 'villager',
      priority: 70,
      anim: 'none',
      label: (ctx) => `Поговорить: ${defs.get(ctx.target!.villager!.id)?.name ?? ''}`,
      when: (ctx) => !brains.get(ctx.target!)?.asleep,
      run: (ctx) => {
        talking.value = ctx.target!
        talkingTo = ctx.target!
        api.ui.open('villagers:talk')
        api.events.emit('villagers:talked', { id: ctx.target!.villager!.id })
      },
    })
    interactions.register({
      id: 'villagers:knock',
      entity: 'villagerHome',
      priority: 50,
      anim: 'none',
      sound: 'core:dig',
      label: 'Постучать',
      run: (ctx) => {
        const id = ctx.target!.villagerHome!.id
        const v = defs.get(id)
        const npc = npcOf(id)
        const asleep = npc ? brains.get(npc)?.asleep : false
        api.ui.toast(asleep ? `Тишина… ${v?.name ?? 'Кто-то'} спит. Zzz` : `${v?.name ?? 'Хозяин'} сейчас гуляет где-то на острове.`)
      },
    })
    api.events.on('ui:closed', ({ id }) => {
      if (id !== 'villagers:talk') return
      talking.value = null
      talkingTo = null
    })
    api.ui.window({
      id: 'villagers:talk',
      title: 'Разговор',
      backdrop: 'clear',
      align: 'bottom',
      component: () => <Talk api={api} cfg={cfg} who={talking} state={state} touch={touch} defs={defs} personalities={personalities} lines={lines} photoId={photoId} />,
    })

    // --- notes, tutorial, commands -----------------------------------------------------------------
    try {
      api.registry('daily:sections').register({
        id: 'villagers:news',
        order: 25,
        line: () => {
          const st = state.value
          const news = st.news
          st.news = []
          if (news.length) return { icon: '🏡', text: news.join(' ') }
          const asks = Object.entries(st.residents).filter(([, r]) => r.request).map(([id]) => defs.get(id)?.name)
          return asks.length ? { icon: '📝', text: `Ждут вашей помощи: ${asks.join(', ')}.` } : null
        },
      })
    } catch {
      // no daily notes
    }
    try {
      api.registry('tutorial:steps').register({
        id: 'villagers:tutorial_talk',
        order: 72,
        text: 'Поговорите с кем-нибудь из соседей.',
        keys: ['player:use'],
        event: 'ui:opened',
        when: (p: { id: string }) => p.id === 'villagers:talk',
      })
    } catch {
      // no tutorial
    }

    api.commands.register({
      name: 'villagers',
      description: 'Жители: villagers · villagers add [id] · villagers friend <id> <очки> · villagers leave <id>',
      usage: '[add [id] | friend id points | leave id]',
      run: ([what, id, n]) => {
        if (what === 'add') {
          const v = id ? defs.get(id.includes(':') ? id : `villagers:${id}`) : newcomers()[0]
          if (!v || resident(v.id)) throw new Error('нет такого или уже живёт')
          if (!moveIn(v)) throw new Error('нет места для дома')
        }
        const full = id && (id.includes(':') ? id : `villagers:${id}`)
        if (what === 'friend' && full && resident(full)) {
          resident(full)!.points = Math.max(0, Math.min(MAX_POINTS, Number(n)))
          touch()
        }
        if (what === 'leave' && full && resident(full)) {
          resident(full)!.leaving = api.time.dayIndex + 1
          touch()
        }
        return Object.entries(state.value.residents)
          .map(([rid, r]) => {
            const v = defs.get(rid)
            const npc = npcOf(rid)
            const b = npc ? brains.get(npc) : undefined
            return `${(v?.name ?? rid).padEnd(10)} ${'♥'.repeat(hearts(r.points))}${'♡'.repeat(5 - hearts(r.points))} ${b?.asleep ? 'спит' : (b?.activity ?? '')}${r.request ? ` · просит ${r.request.label}` : ''}${r.leaving >= 0 ? ' · собирается уезжать' : ''}`
          })
          .join('\n')
      },
    })
  },
})
