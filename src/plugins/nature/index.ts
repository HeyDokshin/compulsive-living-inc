/**
 * Living nature: fruit and oak trees (shake for fruit, chop for wood, plant fruit or saplings — they
 * grow over days), rocks to hit for stone and iron, daily dig spots with fossils. Trees change color
 * with the seasons. Everything advances on `time:day`, including days missed while away.
 */
import { definePlugin, z, type Entity, type InteractionContext, type PluginApi, type RegistryEntry, type Season } from '@sdk'
import { DEFAULT_RULES, chop, liveDay, newTree, shake, type GrowthRules, type TreeState } from './growth'

export interface TreeKind extends RegistryEntry {
  name: string
  fruitItem?: string
  fruitModel?: string
  sapling?: string
  /** Canopy palette per season (chars l, d, h). */
  seasons?: Partial<Record<Season, Record<string, string>>>
}

declare module '@sdk' {
  interface Components {
    tree?: TreeState
    rock?: { hits: number; day: number }
    digSpot?: Record<string, never>
    /** Can't be walked through. */
    blocker?: Record<string, never>
  }
  interface Registries {
    'nature:trees': TreeKind
  }
}

const SEASON_CANOPY: Record<Season, Record<string, string>> = {
  spring: { l: '#a5dd8a', d: '#7fc06e', h: '#ffd1e3' },
  summer: { l: '#7cc45e', d: '#5aa64a', h: '#9ad97a' },
  autumn: { l: '#f0a54a', d: '#d9803a', h: '#f6cf6a' },
  winter: { l: '#e9f0f5', d: '#8aa58a', h: '#ffffff' },
}

const Config = z.object({
  trees: z.number().int().min(0).max(300).default(48).meta({ step: 1 }),
  /** Share of oaks (no fruit); the rest are mostly the island's native fruit. */
  oakShare: z.number().min(0).max(1).default(0.45).meta({ label: 'oak share', step: 0.05 }),
  /** Of the fruit trees, how many bear a non-native fruit. */
  foreignShare: z.number().min(0).max(1).default(0.1).meta({ label: 'foreign fruit share', step: 0.05 }),
  rocks: z.number().int().min(0).max(40).default(6).meta({ step: 1 }),
  /** Size of grown trees: world units per voxel of the tree rig (1/12 = character scale). */
  treeScale: z.number().min(0.03).max(0.2).default(1 / 9).meta({ label: 'tree scale', step: 0.005 }),
  digSpots: z.number().int().min(0).max(30).default(4).meta({ label: 'dig spots per day', step: 1 }),
  rockHitsPerDay: z.number().int().min(1).max(20).default(5).meta({ label: 'rock hits per day', step: 1 }),
  daysPerStage: z.number().int().min(1).max(30).default(DEFAULT_RULES.daysPerStage).meta({ label: 'days per growth stage', step: 1 }),
  fruitDays: z.number().int().min(1).max(30).default(DEFAULT_RULES.fruitDays).meta({ label: 'days to regrow fruit', step: 1 }),
  woodPerDay: z.number().int().min(1).max(20).default(DEFAULT_RULES.woodPerDay).meta({ label: 'wood per tree per day', step: 1 }),
})
type Config = z.infer<typeof Config>

interface Planned {
  trees: Array<{ x: number; y: number; z: number; kind: string }>
  rocks: Array<{ x: number; y: number; z: number }>
}

export default definePlugin({
  id: 'nature',
  version: '0.1.0',
  description: 'Деревья с фруктами, камни, раскопки; рост по дням и сезоны',
  dependsOn: ['terrain', 'items'],
  optionalDependsOn: ['tutorial'],

  setup(api) {
    const cfg = api.config.define(Config)
    api.config.onChange(() => refreshAll())
    const rules = (): GrowthRules => ({ daysPerStage: cfg.daysPerStage, fruitDays: cfg.fruitDays, fruitCount: 3, woodPerDay: cfg.woodPerDay })
    const kinds = api.createRegistry<TreeKind>('nature:trees')
    const items = () => api.services.get('items:inventory')

    const obj = z.object({}).strict()
    api.components.define(
      'tree',
      z.object({
        kind: z.string(),
        stage: z.number().int(),
        fruit: z.number().int(),
        fruitDay: z.number(),
        growDay: z.number(),
        wood: z.number().int(),
        woodDay: z.number(),
      }),
    )
    api.components.define('rock', z.object({ hits: z.number().int(), day: z.number() }))
    api.components.define('digSpot', obj)
    api.components.define('blocker', obj)

    // --- blockers (trees, rocks): cells characters walk around -----------------------------
    const blocked = new Map<string, number>() // "x,z" → ground y
    const cellKey = (x: number, z: number) => `${x},${z}`
    const track = (e: Entity, on: boolean) => {
      if (!e.blocker || !e.transform) return
      const k = cellKey(Math.floor(e.transform.x), Math.floor(e.transform.z))
      if (on) blocked.set(k, Math.round(e.transform.y))
      else blocked.delete(k)
    }
    api.events.on('entity:spawned', ({ entity }) => track(entity, true))
    api.events.on('entity:despawned', ({ entity }) => track(entity, false))
    api.events.on('session:started', () => {
      blocked.clear()
      for (const e of api.entities.world.with('blocker')) track(e, true)
    })
    for (const e of api.entities.world.with('blocker')) track(e, true) // hot reload
    api.hooks.tap('movement:blocked', (b, { x, y, z }) => {
      if (b) return b
      const gy = blocked.get(cellKey(x, z))
      return gy !== undefined && y >= gy - 1 && y <= gy + 2
    })

    // --- looks ------------------------------------------------------------------------------
    const updateTree = (e: Entity) => {
      const t = e.tree!
      const kind = kinds.get(t.kind)
      const season = api.time.season
      const palette = { ...SEASON_CANOPY[season], ...kind?.seasons?.[season] }
      const fruit = kind?.fruitModel ?? 'nature:none'
      const show = (n: number) => (t.fruit >= n && season !== 'winter' ? fruit : 'nature:none')
      e.model =
        t.stage === 0
          ? { shape: 'rig', ref: 'nature:sapling', size: [1, 1, 1], color: '#ccc', anchor: 'bottom' }
          : {
              shape: 'rig',
              ref: 'nature:tree',
              size: [1, 1, 1],
              color: '#ccc',
              anchor: 'bottom',
              scale: cfg.treeScale * (t.stage === 1 ? 0.6 : 1),
              palette,
              parts: { fruitA: show(1), fruitB: show(2), fruitC: show(3) },
            }
      e.name = kind ? (t.stage < 2 ? `${kind.name} (молодое)` : kind.name) : 'Дерево'
      api.render.refreshView(e)
    }
    const refreshAll = () => {
      for (const e of api.entities.world.with('tree')) updateTree(e)
    }
    api.events.on('time:season', refreshAll)
    api.events.on('session:started', refreshAll)

    // A shaken tree wobbles for a moment.
    const wobble = new WeakMap<object, number>()
    let clock = 0
    api.systems.add({
      id: 'wobble',
      phase: 'render',
      run: ({ dt }) => {
        clock += dt
        for (const e of api.entities.world.with('tree', 'view')) {
          const start = wobble.get(e)
          if (start === undefined) continue
          const age = clock - start
          const canopy = e.view.getObjectByName('canopy')
          if (canopy) canopy.rotation.z = age < 0.8 ? Math.sin(age * 38) * 0.07 * (1 - age / 0.8) : 0
          if (age >= 0.8) wobble.delete(e)
        }
      },
    })

    // --- world generation ---------------------------------------------------------------------
    let planned: Planned = { trees: [], rocks: [] }
    api.registry('worldgen').register({
      id: 'nature:scatter',
      order: 510,
      description: 'Groves of trees on grass, rocks near cliffs',
      run: (ctx) => {
        const t = ctx.data.terrain as { land: Uint8Array; river: Uint8Array; stairs?: Uint8Array; bridge?: Int16Array } | undefined
        const rng = ctx.rng('nature')
        const grove = ctx.noise('groves')
        const fruitKinds = kinds.all().filter((k) => k.fruitItem)
        const native = fruitKinds.length ? fruitKinds[Math.floor(rng() * fruitKinds.length)]!.id : undefined
        const oak = kinds.all().find((k) => !k.fruitItem)?.id
        const ok = (i: number, x: number, z: number) =>
          x > 2 && z > 2 && x < ctx.sizeX - 3 && z < ctx.sizeZ - 3 && ctx.surface[i] === 'core:grass' && !t?.river[i] && !t?.stairs?.[i] && !t?.bridge?.[i] && ctx.waterMap[i]! <= ctx.heightMap[i]!
        const taken = new Set<string>()
        const free = (x: number, z: number, r: number) => {
          for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (taken.has(`${x + dx},${z + dz}`)) return false
          return true
        }
        const trees: Planned['trees'] = []
        for (let tries = 0; tries < cfg.trees * 60 && trees.length < cfg.trees; tries++) {
          const x = Math.floor(rng() * ctx.sizeX)
          const z = Math.floor(rng() * ctx.sizeZ)
          const i = ctx.index(x, z)
          if (!ok(i, x, z) || !free(x, z, 1)) continue
          if (grove(x * 0.06, z * 0.06) < -0.15 && rng() < 0.85) continue // trees grow in groves
          taken.add(`${x},${z}`)
          const r = rng()
          let kind = oak ?? native
          if (native && r > cfg.oakShare) kind = rng() < cfg.foreignShare ? fruitKinds[Math.floor(rng() * fruitKinds.length)]!.id : native
          if (kind) trees.push({ x, y: ctx.heightMap[i]!, z, kind })
        }
        const rocks: Planned['rocks'] = []
        for (let tries = 0; tries < 4000 && rocks.length < cfg.rocks; tries++) {
          const x = Math.floor(rng() * ctx.sizeX)
          const z = Math.floor(rng() * ctx.sizeZ)
          const i = ctx.index(x, z)
          if (!ok(i, x, z) || !free(x, z, 2)) continue
          const h = ctx.heightMap[i]!
          const nearCliff = [ctx.index(x + 1, z), ctx.index(x - 1, z), ctx.index(x, z + 1), ctx.index(x, z - 1)].some((j) => ctx.heightMap[j]! >= h + 2)
          if (!nearCliff && rng() < 0.9) continue
          taken.add(`${x},${z}`)
          rocks.push({ x, y: h, z })
        }
        planned = { trees, rocks }
      },
    })

    const despawnAll = () => {
      for (const c of ['tree', 'rock', 'digSpot'] as const) for (const e of [...api.entities.world.with(c)]) api.entities.despawn(e)
    }
    const spawnPlanned = () => {
      const today = api.time.dayIndex
      // Heights come from the actual world (a loaded island may differ from a fresh generation).
      const ground = (x: number, z: number) => {
        const y = api.world.surfaceY(x, z)
        return y > 0 && api.world.getBlock(x, y - 1, z) === 'core:grass' && api.world.getBlock(x, y, z) === api.world.AIR ? y : null
      }
      for (const p of planned.trees) {
        const kind = kinds.get(p.kind)
        const y = ground(p.x, p.z)
        if (y === null) continue
        const e = api.entities.spawn('nature:tree', {
          transform: { x: p.x + 0.5, y, z: p.z + 0.5, rotY: Math.floor(Math.random() * 4) * (Math.PI / 2) },
          tree: newTree(p.kind, today, 2, !!kind?.fruitItem, rules()),
        })
        updateTree(e)
      }
      for (const p of planned.rocks) {
        const y = ground(p.x, p.z)
        if (y === null) continue
        api.entities.spawn('nature:rock', { transform: { x: p.x + 0.5, y, z: p.z + 0.5, rotY: Math.random() * Math.PI * 2 }, rock: { hits: 0, day: today } })
      }
      spawnDigSpots()
    }

    // Dig spots: a few new ones every day, on grass or sand, deterministic per island and day.
    const spawnDigSpots = () => {
      for (const e of [...api.entities.world.with('digSpot')]) api.entities.despawn(e)
      const w = api.world
      let seed = (w.seed ^ Math.imul(api.time.dayIndex, 0x9e3779b1)) >>> 0
      const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
      let placed = 0
      for (let tries = 0; tries < 2000 && placed < cfg.digSpots; tries++) {
        const x = 3 + Math.floor(rand() * (w.sizeX - 6))
        const z = 3 + Math.floor(rand() * (w.sizeZ - 6))
        const y = w.surfaceY(x, z)
        const top = w.getBlock(x, y - 1, z)
        if (y <= 0 || (top !== 'core:grass' && top !== 'core:sand') || w.getBlock(x, y, z) !== w.AIR) continue
        if (blocked.has(cellKey(x, z)) || entitiesAt(api, x, z).length) continue
        api.entities.spawn('nature:dig_spot', { transform: { x: x + 0.5, y: y + 0.01, z: z + 0.5, rotY: 0 } })
        placed++
      }
    }

    api.save.register<{ seeded: boolean }>({ version: 1, save: () => ({ seeded: true }), load: () => undefined })
    let live = false
    api.events.on('session:started', () => {
      live = true
      // New island, or an older save from before this plugin existed: plant it now.
      if (!api.save.hasData && ![...api.entities.world.with('tree')].length) spawnPlanned()
    })
    api.events.on('world:generated', () => {
      if (!live) return // first generation of a session: handled on session:started
      despawnAll()
      spawnPlanned()
    })

    // --- days ----------------------------------------------------------------------------------
    api.events.on('time:day', ({ dayIndex, catchUp }) => {
      for (const e of api.entities.world.with('tree')) {
        const kind = kinds.get(e.tree.kind)
        if (liveDay(e.tree, dayIndex, !!kind?.fruitItem, rules())) updateTree(e)
      }
      for (const e of api.entities.world.with('rock')) {
        e.rock.hits = 0
        e.rock.day = dayIndex
      }
      if (!catchUp) spawnDigSpots()
    })

    // --- interactions ----------------------------------------------------------------------------
    const interactions = api.registry('interactions')
    const isAxe = (held: string | null) => !!held && api.registry('items').isTagged(held, '#core:axes')
    const canopyColors = (e: Entity) => {
      const p = e.model?.palette ?? SEASON_CANOPY.summer
      return [p.l, p.h].filter(Boolean) as string[]
    }
    const leaves = (e: Entity) => {
      const t = e.transform!
      const colors = canopyColors(e)
      api.fx.burst('nature:leaves', { x: t.x, y: t.y + 1.6, z: t.z }, { color: colors[Math.floor(Math.random() * colors.length)] })
    }

    interactions.register({
      id: 'nature:shake',
      entity: 'tree',
      priority: 30,
      anim: 'none',
      label: (ctx) => (ctx.target!.tree!.stage < 2 ? 'Подрастает…' : 'Потрясти'),
      when: (ctx) => !isAxe(ctx.held) && !(ctx.target!.tree!.stage < 2 && api.registry('items').isTagged(ctx.held ?? '', '#core:shovels')),
      run: (ctx) => {
        const e = ctx.target!
        if (e.tree!.stage < 2) return false
        wobble.set(e, clock)
        api.audio.play('nature:rustle', { at: e.transform })
        leaves(e)
        const kind = kinds.get(e.tree!.kind)
        const n = shake(e.tree!, api.time.dayIndex, rules())
        if (n && kind?.fruitItem) {
          for (const cell of freeCellsAround(api, e, blocked, n)) {
            items().spawnDrop(kind.fruitItem, 1, cell.x + 0.5, cell.y, cell.z + 0.5)
            api.audio.play('nature:fruit_drop', { at: { x: cell.x, z: cell.z } })
          }
          updateTree(e)
        }
      },
    })
    interactions.register({
      id: 'nature:chop',
      tool: '#core:axes',
      entity: 'tree',
      priority: 40,
      label: 'Рубить',
      when: (ctx) => ctx.target!.tree!.stage === 2,
      sound: 'nature:chop',
      particles: 'nature:chips',
      run: (ctx) => {
        const e = ctx.target!
        wobble.set(e, clock)
        if (!chop(e.tree!, api.time.dayIndex, rules())) {
          api.ui.toast('Сегодня это дерево уже отдало всю древесину')
          return
        }
        const [cell] = freeCellsAround(api, e, blocked, 1, ctx.actor)
        if (cell) items().spawnDrop('core:wood', 1, cell.x + 0.5, cell.y, cell.z + 0.5)
      },
    })
    interactions.register({
      id: 'nature:dig_up',
      tool: '#core:shovels',
      entity: 'tree',
      priority: 40,
      label: 'Выкопать',
      when: (ctx) => ctx.target!.tree!.stage < 2,
      sound: 'core:dig',
      particles: 'core:clods',
      run: (ctx) => {
        const e = ctx.target!
        const sapling = kinds.get(e.tree!.kind)?.sapling
        api.entities.despawn(e)
        if (sapling && items().add(ctx.actor, sapling, 1) > 0) {
          items().spawnDrop(sapling, 1, ctx.x + 0.5, ctx.y + 1, ctx.z + 0.5)
        }
      },
    })

    const canPlantAt = (ctx: InteractionContext) => {
      if (ctx.entities.length || ctx.y < 0) return false
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (blocked.has(cellKey(ctx.x + dx, ctx.z + dz))) return false
      return api.world.getBlock(ctx.x, ctx.y + 1, ctx.z) === api.world.AIR
    }
    const plant = (ctx: InteractionContext, kindId: string) => {
      const kind = kinds.get(kindId)
      if (items().remove(ctx.actor, ctx.held!, 1) !== 1) return false
      const e = api.entities.spawn('nature:tree', {
        transform: { x: ctx.x + 0.5, y: ctx.y + 1, z: ctx.z + 0.5, rotY: 0 },
        tree: newTree(kindId, api.time.dayIndex, 0, !!kind?.fruitItem, rules()),
      })
      updateTree(e)
      api.ui.toast(`Посажено: ${kind?.name ?? 'дерево'}. Подрастёт через пару дней.`)
    }
    interactions.register({
      id: 'nature:plant_fruit',
      tool: '#core:fruits',
      block: '#core:flora_soil',
      priority: 10,
      label: 'Посадить',
      sound: 'core:dig',
      particles: 'core:clods',
      particleColor: 'block',
      when: (ctx) => canPlantAt(ctx) && !!kinds.all().find((k) => k.fruitItem === ctx.held),
      run: (ctx) => plant(ctx, kinds.all().find((k) => k.fruitItem === ctx.held)!.id),
    })
    interactions.register({
      id: 'nature:plant_sapling',
      tool: '#nature:saplings',
      block: '#core:flora_soil',
      priority: 10,
      label: 'Посадить',
      sound: 'core:dig',
      particles: 'core:clods',
      particleColor: 'block',
      when: (ctx) => canPlantAt(ctx) && !!kinds.all().find((k) => k.sapling === ctx.held),
      run: (ctx) => plant(ctx, kinds.all().find((k) => k.sapling === ctx.held)!.id),
    })

    interactions.register({
      id: 'nature:hit_rock',
      tool: '#nature:rock_tools',
      entity: 'rock',
      priority: 40,
      label: 'Ударить',
      sound: 'nature:rock_hit',
      particles: 'nature:rock_chips',
      run: (ctx) => {
        const rock = ctx.target!.rock!
        if (rock.day !== api.time.dayIndex) {
          rock.hits = 0
          rock.day = api.time.dayIndex
        }
        if (rock.hits >= cfg.rockHitsPerDay) {
          api.ui.toast('Камень на сегодня всё. Приходите завтра!')
          return
        }
        rock.hits++
        const [cell] = freeCellsAround(api, ctx.target!, blocked, 1, ctx.actor)
        if (cell) items().spawnDrop(Math.random() < 0.2 ? 'nature:iron' : 'core:stone', 1, cell.x + 0.5, cell.y, cell.z + 0.5)
      },
    })

    interactions.register({
      id: 'nature:dig_spot',
      tool: '#core:shovels',
      entity: 'digSpot',
      priority: 60,
      label: 'Раскопать',
      sound: 'core:dig',
      particles: 'core:clods',
      particleColor: 'block',
      run: (ctx) => {
        api.entities.despawn(ctx.target!)
        const id = Math.random() < 0.75 ? 'nature:fossil' : 'nature:iron'
        items().spawnDrop(id, 1, ctx.x + 0.5, ctx.y + 1, ctx.z + 0.5)
        api.fx.burst('core:sparkle', { x: ctx.x + 0.5, y: ctx.y + 1.3, z: ctx.z + 0.5 })
      },
    })

    // A step for the first-minutes tutorial, if it is installed.
    try {
      api.registry('tutorial:steps').register({
        id: 'nature:tutorial_shake',
        order: 55,
        text: 'Потрясите дерево — вдруг упадёт фрукт.',
        keys: ['Space'],
        event: 'interaction:performed',
        when: (p: { id: string }) => p.id === 'nature:shake',
      })
    } catch {
      // no tutorial plugin
    }

    api.commands.register({
      name: 'trees',
      description: 'Деревья острова: сколько, каких, с фруктами',
      run: () => {
        const by = new Map<string, { n: number; fruit: number; young: number }>()
        for (const e of api.entities.world.with('tree')) {
          const s = by.get(e.tree.kind) ?? { n: 0, fruit: 0, young: 0 }
          s.n++
          s.fruit += e.tree.fruit
          if (e.tree.stage < 2) s.young++
          by.set(e.tree.kind, s)
        }
        return [...by].map(([k, s]) => `${(kinds.get(k)?.name ?? k).padEnd(10)} ${s.n} (молодых ${s.young}), фруктов ${s.fruit}`).join('\n') || 'деревьев нет'
      },
    })
  },
})

function entitiesAt(api: PluginApi, x: number, z: number): Entity[] {
  const out: Entity[] = []
  for (const e of api.entities.world.with('transform')) if (Math.floor(e.transform.x) === x && Math.floor(e.transform.z) === z) out.push(e)
  return out
}

/** Free neighbour cells of an entity (prefer the side facing `towards`) for dropping things. */
function freeCellsAround(api: PluginApi, e: Entity, blocked: Map<string, number>, n: number, towards?: Entity): Array<{ x: number; y: number; z: number }> {
  const t = e.transform!
  const cx = Math.floor(t.x)
  const cz = Math.floor(t.z)
  let dirs: Array<[number, number]> = [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]
  if (towards?.transform) {
    const ax = towards.transform.x - t.x
    const az = towards.transform.z - t.z
    dirs = dirs.sort((a, b) => b[0] * ax + b[1] * az - (a[0] * ax + a[1] * az))
  } else dirs = dirs.sort(() => Math.random() - 0.5)
  const blocks = api.registry('blocks')
  const out: Array<{ x: number; y: number; z: number }> = []
  for (const [dx, dz] of dirs) {
    if (out.length >= n) break
    const x = cx + dx
    const z = cz + dz
    const y = api.world.surfaceY(x, z)
    if (y <= 0 || blocked.has(`${x},${z}`) || Math.abs(y - t.y) > 1) continue
    if (blocks.isTagged(api.world.getBlock(x, y, z), '#core:liquid') || blocks.isTagged(api.world.getBlock(x, y - 1, z), '#core:liquid')) continue
    if (entitiesAt(api, x, z).some((o) => o.item || o.tree || o.rock)) continue
    out.push({ x, y, z })
  }
  return out
}
