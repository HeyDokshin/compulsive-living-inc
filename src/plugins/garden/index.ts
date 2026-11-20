/**
 * Flowers you can pick, plant, water and breed. Species and color genetics are data
 * (content/garden/garden.species.json5). Each morning, flowers that were watered (or rained on)
 * may give a new flower next to them — sometimes in a new color. Wild patches grow on new islands.
 */
import { definePlugin, z, type Entity, type InteractionContext, type RegistryEntry } from '@sdk'
import { breedColor, type BreedRule } from './genetics'

export interface Species extends RegistryEntry {
  name: string
  /** Short name used in item ids: garden:<short>_<color>. */
  short: string
  model: string
  colors: Record<string, string>
  /** Extra palette per color (beyond petals `p`). */
  palette?: Record<string, Record<string, string>>
  base: string[]
  breeding: BreedRule[]
}

declare module '@sdk' {
  interface Components {
    flower?: { species: string; color: string; watered: number; planted: number }
  }
  interface Registries {
    'garden:species': Species
  }
}

const COLOR_NAMES: Record<string, string> = {
  red: 'красный',
  white: 'белый',
  yellow: 'жёлтый',
  pink: 'розовый',
  orange: 'оранжевый',
  purple: 'фиолетовый',
  black: 'чёрный',
  blue: 'голубой',
}

const Config = z.object({
  /** Chance per day that a watered flower with a watered neighbour of its species gives a new one. */
  breedChance: z.number().min(0).max(1).default(0.45).meta({ label: 'breed chance', step: 0.05 }),
  wildPatches: z.number().int().min(0).max(40).default(7).meta({ label: 'wild patches', step: 1 }),
  /** Breeding stops when this many flowers are on the island. */
  maxFlowers: z.number().int().min(10).max(2000).default(400).meta({ label: 'max flowers', step: 10 }),
})

const flowerItem = (s: Species, color: string) => `garden:${s.short}_${color}`
const seedsItem = (s: Species) => `garden:seeds_${s.short}`

export default definePlugin({
  id: 'garden',
  version: '0.1.0',
  description: 'Цветы: сорвать, посадить, полить, вывести новые цвета',
  dependsOn: ['items'],
  optionalDependsOn: ['weather', 'nature'],

  setup(api) {
    const cfg = api.config.define(Config)
    const species = api.createRegistry<Species>('garden:species')
    const items = () => api.services.get('items:inventory')
    api.components.define(
      'flower',
      z.object({ species: z.string(), color: z.string(), watered: z.number().default(-1), planted: z.number().default(0) }),
    )

    // Items for every species × color, plus seed bags — generated from the species data.
    const registerItems = () => {
      const reg = api.registry('items')
      for (const s of species.all()) {
        for (const [color, hex] of Object.entries(s.colors)) {
          const id = flowerItem(s, color)
          if (reg.has(id)) continue
          reg.register({
            id,
            name: `${s.name}, ${COLOR_NAMES[color] ?? color}`,
            stack: 10,
            model: s.model,
            palette: { p: hex, ...s.palette?.[color] },
            tags: ['garden:flowers'],
            price: s.base.includes(color) ? 40 : 160,
            held: { grip: [2.5, 2, 2.5], tilt: 0, scale: 1 },
          })
        }
        const seeds = seedsItem(s)
        if (!reg.has(seeds)) {
          reg.register({ id: seeds, name: `Семена: ${s.name.toLowerCase()}`, stack: 10, model: 'garden:seeds', tags: ['garden:seeds'], price: 40, held: { tilt: 0, scale: 1 } })
        }
      }
    }
    api.events.on('content:loaded', registerItems)
    registerItems()

    const look = (e: Entity) => {
      const f = e.flower!
      const s = species.get(f.species)
      if (!s) return
      e.model = { shape: 'voxel', ref: s.model, palette: { p: s.colors[f.color] ?? '#ff00ff', ...s.palette?.[f.color] }, size: [1, 1, 1], color: '#ccc', anchor: 'bottom' }
      e.name = `${s.name}, ${COLOR_NAMES[f.color] ?? f.color}`
      api.render.refreshView(e)
    }
    const spawnFlower = (speciesId: string, color: string, x: number, y: number, z: number) => {
      const e = api.entities.spawn({
        transform: { x: x + 0.5, y, z: z + 0.5, rotY: Math.random() * Math.PI * 2 },
        flower: { species: speciesId, color, watered: -1, planted: api.time.dayIndex },
        blobShadow: { radius: 0.18, opacity: 0.2 },
      })
      look(e)
      return e
    }

    const blocks = api.registry('blocks')
    const soilAt = (x: number, z: number): number | null => {
      const y = api.world.surfaceY(x, z)
      if (y <= 0 || !blocks.isTagged(api.world.getBlock(x, y - 1, z), '#core:flora_soil')) return null
      if (api.world.getBlock(x, y, z) !== api.world.AIR) return null
      if (api.hooks.run('movement:blocked', false, { x, y, z })) return null // tree, rock, hole…
      for (const e of api.entities.world.with('transform')) if (Math.floor(e.transform.x) === x && Math.floor(e.transform.z) === z) return null
      return y
    }

    // --- wild patches on a new island ---------------------------------------------------------
    const spawnWild = () => {
      const w = api.world
      let seed = (w.seed ^ 0xf10e) >>> 0
      const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
      const all = species.all()
      if (!all.length) return
      for (let p = 0, tries = 0; p < cfg.wildPatches && tries < 500; tries++) {
        const cx = 6 + Math.floor(rand() * (w.sizeX - 12))
        const cz = 6 + Math.floor(rand() * (w.sizeZ - 12))
        if (soilAt(cx, cz) === null) continue
        const s = all[p % all.length]!
        const color = s.base[Math.floor(rand() * s.base.length)]!
        let n = 0
        for (let k = 0; k < 14 && n < 5; k++) {
          const x = cx + Math.floor(rand() * 5) - 2
          const z = cz + Math.floor(rand() * 5) - 2
          const y = soilAt(x, z)
          if (y === null) continue
          spawnFlower(s.id, rand() < 0.75 ? color : s.base[Math.floor(rand() * s.base.length)]!, x, y, z)
          n++
        }
        p++
      }
    }
    api.save.register<{ seeded: boolean }>({ version: 1, save: () => ({ seeded: true }), load: () => undefined })
    let live = false
    api.events.on('session:started', () => {
      live = true
      // New island, or an older save from before this plugin existed: plant it now.
      if (!api.save.hasData && ![...api.entities.world.with('flower')].length) spawnWild()
      for (const e of api.entities.world.with('flower')) look(e)
    })
    api.events.on('world:generated', () => {
      if (!live) return
      for (const e of [...api.entities.world.with('flower')]) api.entities.despawn(e)
      spawnWild()
    })

    // --- each morning: breeding ---------------------------------------------------------------
    api.events.on('time:day', ({ dayIndex }) => {
      const yesterday = dayIndex - 1
      const forecast = api.services.has('weather:forecast') ? api.services.get('weather:forecast') : null
      const rained = !!forecast?.rainedOn(yesterday)
      const flowers = [...api.entities.world.with('flower', 'transform')]
      if (flowers.length >= cfg.maxFlowers) return
      const at = new Map<string, Entity>(flowers.map((e) => [`${Math.floor(e.transform.x)},${Math.floor(e.transform.z)}`, e]))
      const watered = (e: Entity) => rained || e.flower!.watered === yesterday
      let born = 0
      for (const e of flowers) {
        if (!watered(e) || Math.random() > cfg.breedChance) continue
        const cx = Math.floor(e.transform.x)
        const cz = Math.floor(e.transform.z)
        // a watered partner of the same species next to it
        const partners: Entity[] = []
        const spots: Array<[number, number]> = []
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dz) continue
            const o = at.get(`${cx + dx},${cz + dz}`)
            if (o) {
              if (o.flower!.species === e.flower!.species && watered(o)) partners.push(o)
            } else spots.push([cx + dx, cz + dz])
          }
        }
        const s = species.get(e.flower!.species)
        if (!partners.length || !spots.length || !s) continue
        const partner = partners[Math.floor(Math.random() * partners.length)]!
        for (const [x, z] of spots.sort(() => Math.random() - 0.5)) {
          const y = soilAt(x, z)
          if (y === null) continue
          const color = breedColor(s.breeding, e.flower!.color, partner.flower!.color, Math.random)
          at.set(`${x},${z}`, spawnFlower(s.id, color, x, y, z))
          born++
          break
        }
        if (flowers.length + born >= cfg.maxFlowers) break
      }
      if (born && !rained) api.log.info(`${born} new flowers`)
    })

    // --- interactions -----------------------------------------------------------------------------
    const interactions = api.registry('interactions')
    interactions.register({
      id: 'garden:water',
      tool: '#core:watering_cans',
      entity: 'flower',
      priority: 30,
      label: (ctx) => (ctx.target!.flower!.watered === api.time.dayIndex ? 'Уже полит' : 'Полить'),
      sound: 'core:splash',
      particles: 'core:splash',
      run: (ctx) => {
        const f = ctx.target!.flower!
        f.watered = api.time.dayIndex
        const t = ctx.target!.transform!
        api.fx.burst('core:sparkle', { x: t.x, y: t.y + 0.5, z: t.z }, { amount: 0.5 })
      },
    })
    interactions.register({
      id: 'garden:pick',
      entity: 'flower',
      priority: 20,
      anim: 'pickup',
      sound: 'core:pickup',
      label: 'Сорвать',
      when: (ctx) => !ctx.held || !api.registry('items').isTagged(ctx.held, '#core:watering_cans'),
      run: (ctx) => {
        const e = ctx.target!
        const s = species.get(e.flower!.species)
        if (!s) return false
        const id = flowerItem(s, e.flower!.color)
        if (items().add(ctx.actor, id, 1) > 0) {
          api.ui.toast('Карманы полны')
          return false
        }
        api.entities.despawn(e)
      },
    })

    const plantable = (ctx: InteractionContext) => !ctx.entities.length && ctx.y >= 0 && soilAt(ctx.x, ctx.z) !== null
    const plant = (ctx: InteractionContext, speciesId: string, color: string) => {
      if (items().remove(ctx.actor, ctx.held!, 1) !== 1) return false
      spawnFlower(speciesId, color, ctx.x, ctx.y + 1, ctx.z)
    }
    const fromFlowerItem = (held: string | null) => {
      for (const s of species.all()) for (const c of Object.keys(s.colors)) if (flowerItem(s, c) === held) return { s, c }
      return null
    }
    interactions.register({
      id: 'garden:plant_flower',
      tool: '#garden:flowers',
      block: '#core:flora_soil',
      priority: 12,
      label: 'Посадить',
      sound: 'core:dig',
      particles: 'core:clods',
      particleColor: 'block',
      when: (ctx) => plantable(ctx) && !!fromFlowerItem(ctx.held),
      run: (ctx) => {
        const f = fromFlowerItem(ctx.held)!
        return plant(ctx, f.s.id, f.c)
      },
    })
    interactions.register({
      id: 'garden:plant_seeds',
      tool: '#garden:seeds',
      block: '#core:flora_soil',
      priority: 12,
      label: 'Посеять',
      sound: 'core:dig',
      particles: 'core:clods',
      particleColor: 'block',
      when: (ctx) => plantable(ctx) && species.all().some((s) => seedsItem(s) === ctx.held),
      run: (ctx) => {
        const s = species.all().find((x) => seedsItem(x) === ctx.held)!
        return plant(ctx, s.id, s.base[Math.floor(Math.random() * s.base.length)]!)
      },
    })

    // Watered flowers glint now and then (so you can see which ones you watered today).
    let glintIn = 0
    api.systems.add({
      id: 'glints',
      phase: 'render',
      run: ({ dt }) => {
        if ((glintIn -= dt) > 0) return
        glintIn = 0.7
        const today = api.time.dayIndex
        const c = api.render.camera.target
        for (const e of api.entities.world.with('flower', 'transform')) {
          if (e.flower.watered !== today || Math.random() > 0.35) continue
          if (Math.hypot(e.transform.x - c.x, e.transform.z - c.z) > 14) continue
          api.fx.burst('core:glint', { x: e.transform.x, y: e.transform.y + 0.45, z: e.transform.z }, { color: '#bfe8ff', amount: 0.5 })
        }
      },
    })

    api.commands.register({
      name: 'flowers',
      description: 'Цветы на острове по видам и цветам',
      run: () => {
        const by = new Map<string, number>()
        for (const e of api.entities.world.with('flower')) {
          const k = `${species.get(e.flower.species)?.name ?? e.flower.species}, ${COLOR_NAMES[e.flower.color] ?? e.flower.color}`
          by.set(k, (by.get(k) ?? 0) + 1)
        }
        return [...by].sort().map(([k, n]) => `${String(n).padStart(4)}  ${k}`).join('\n') || 'цветов нет'
      },
    })
  },
})

