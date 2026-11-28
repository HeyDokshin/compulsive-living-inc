/**
 * Your house. It stands near the middle of a new island with a mailbox in front; step in and the
 * room is yours to furnish (decor pieces work inside: furniture, rugs, things on tables, pictures on
 * walls). Wallpapers and floors are items you use inside. The mailbox handles the house loan: take
 * it to grow the house (the builders finish overnight), pay it back whenever you like.
 * Levels and finishes are data: content/house/house.levels.json5, house.finishes.json5.
 */
import { definePlugin, signal, ui, z, type Entity, type PluginApi, type ReadonlySignal, type RegistryEntry, type Services } from '@sdk'
import { hatchOf, moveToWall, payment, planRoom, stairsOf, windowsOf, type RoomPlan } from './room'

export const HOME = 'house:home'
/** The attic of the biggest house, up the stairs. */
export const ATTIC = 'house:attic'
type Room = typeof HOME | typeof ATTIC

type Shell = ReturnType<Services['rooms:kit']['build']>
type Surface = Parameters<Services['rooms:kit']['build']>[0]['look']['wall']

export interface LevelDef extends RegistryEntry {
  level: number
  name: string
  model: string
  room: { w: number; d: number }
  /** An attic up the stairs (cells, walls included). */
  attic?: { w: number; d: number }
  cost: number
}

export interface FinishDef extends RegistryEntry {
  kind: 'wall' | 'floor'
  name: string
  block: string
  price: number
  /** The surface you see (rooms kit). */
  look: Surface
  /** Panelling under a wallpaper. */
  wainscot?: Surface & { height: number }
}

interface HouseState {
  level: number
  debt: number
  /** Day the next level is ready (-1 = nothing being built). */
  readyDay: number
  wall: string
  floor: string
  /** The attic's own wallpaper and floor. */
  atticWall: string
  atticFloor: string
  lights: boolean
  /** Curtains drawn. */
  curtains: boolean
  furnished: boolean
}

declare module '@sdk' {
  interface Components {
    home?: Record<string, never>
    mailbox?: Record<string, never>
  }
  interface Registries {
    'house:levels': LevelDef
    'house:finishes': FinishDef
  }
  interface Services {
    'house:info': { level(): number; debt(): number }
  }
}

const Config = z.object({
  floorY: z.number().int().min(2).max(24).default(8).meta({ label: 'floor y', step: 1 }),
  wallHeight: z.number().int().min(2).max(8).default(4).meta({ label: 'wall height', step: 1 }),
  /** House footprint (cells) — matches the models (32 voxels at 1/8). */
  size: z.number().int().min(2).max(8).default(4).meta({ step: 1 }),
  frontRows: z.number().int().min(1).max(4).default(2).meta({ label: 'front rows', step: 1 }),
  clearance: z.number().int().min(0).max(8).default(2).meta({ step: 1 }),
  /** Starting finishes. */
  wall: z.string().default('house:wall_cream'),
  floor: z.string().default('house:floor_planks'),
  /** The attic: lower walls, its own starting finishes, the stairs up to it and the hatch it opens on. */
  atticWallHeight: z.number().int().min(2).max(8).default(3).meta({ label: 'attic wall height', step: 1 }),
  atticWall: z.string().default('house:wall_logs'),
  atticFloor: z.string().default('house:floor_planks'),
  stairs: z.object({ material: z.string(), color: z.string() }).default({ material: 'core:wood', color: '#d9a56c' }),
  stairsTop: z.object({ material: z.string(), color: z.string() }).default({ material: 'core:planks', color: '#f3dcc0' }),
  hatch: z.object({ material: z.string(), color: z.string() }).default({ material: 'core:wood', color: '#6b4a32' }),
  /** Trims, the door and the mat (rooms kit surfaces). */
  trim: z.object({ material: z.string(), color: z.string() }).default({ material: 'house:painted_wood', color: '#fbf6ee' }),
  door: z.object({ material: z.string(), color: z.string() }).default({ material: 'core:wood', color: '#e9c9a3' }),
  curtain: z.object({ material: z.string(), color: z.string() }).default({ material: 'house:curtain', color: '#fffaf2' }),
  mat: z.object({ material: z.string(), color: z.string() }).default({ material: 'house:doormat', color: '#e8d2ae' }),
  /** With the lights off: share of the room light left. */
  dark: z.number().min(0).max(1).default(0.4).meta({ label: 'lights off', step: 0.05 }),
  /** Furniture put in the room the first time you come home. */
  starter: z.array(z.object({ piece: z.string(), variant: z.string(), dx: z.number(), dz: z.number() })).default([
    { piece: 'decor:bed', variant: 'mint', dx: -2, dz: -2 },
    { piece: 'decor:rug_round', variant: 'pink', dx: 0, dz: 0 },
    { piece: 'decor:table', variant: 'natural', dx: 2, dz: -2 },
  ]),
})
type Config = z.infer<typeof Config>

export default definePlugin({
  id: 'house',
  version: '0.1.0',
  description: 'Дом: интерьер, мебель, обои и полы, кредит и расширение',
  dependsOn: ['items', 'decor', 'economy', 'rooms'],
  // placed after the museum, the shop and the sell box: the house takes the next free plot
  optionalDependsOn: ['museum', 'shop', 'nature', 'garden', 'tutorial', 'daily'],

  setup(api) {
    const cfg = api.config.define(Config)
    const levels = api.createRegistry<LevelDef>(
      'house:levels',
      z.looseObject({
        id: z.string(),
        level: z.number().int(),
        name: z.string(),
        model: z.string(),
        room: z.object({ w: z.number().int(), d: z.number().int() }),
        attic: z.object({ w: z.number().int(), d: z.number().int() }).optional(),
        cost: z.number().int().min(0),
      }) as never,
    )
    const finishes = api.createRegistry<FinishDef>(
      'house:finishes',
      z.looseObject({
        id: z.string(),
        kind: z.enum(['wall', 'floor']),
        name: z.string(),
        block: z.string(),
        price: z.number().int().min(0).default(500),
        look: z.object({ material: z.string(), color: z.string() }),
        wainscot: z.object({ material: z.string(), color: z.string(), height: z.number().min(0.1).max(3) }).optional(),
      }) as never,
    )
    api.interiors.define(HOME, { name: 'Мой дом', icon: '🏠' })
    api.interiors.define(ATTIC, { name: 'Мансарда', icon: '🪜' })
    api.components.define('home', z.object({}))
    api.components.define('mailbox', z.object({}))
    const area = api.interiors.area(HOME)
    const atticArea = api.interiors.area(ATTIC)
    const areaOf = (room: Room) => (room === HOME ? area : atticArea)
    const inventory = () => api.services.get('items:inventory')
    const decor = () => api.services.get('decor:pieces')

    const fresh = (): HouseState => ({
      level: 1,
      debt: 0,
      readyDay: -1,
      wall: cfg.wall,
      floor: cfg.floor,
      atticWall: cfg.atticWall,
      atticFloor: cfg.atticFloor,
      lights: true,
      curtains: false,
      furnished: false,
    })
    const state = signal<HouseState>(fresh())
    const set = (patch: Partial<HouseState>) => {
      state.value = { ...state.value, ...patch }
      shell?.setLights(state.value.lights)
      shell?.setCurtains(state.value.curtains)
    }
    let shell: Shell | null = null
    api.save.register<HouseState>({
      version: 1,
      save: () => state.value,
      load: (d) => (state.value = { ...fresh(), ...d }),
    })
    api.services.provide('house:info', { level: () => state.value.level, debt: () => state.value.debt })

    const levelDef = (n = state.value.level) => levels.all().find((l) => l.level === n)
    const plan = (room: Room = HOME): RoomPlan => {
      const l = levelDef()
      if (room === ATTIC) return planRoom(l?.attic?.w ?? 8, l?.attic?.d ?? 8, atticArea.w, atticArea.d)
      return planRoom(l?.room.w ?? 8, l?.room.d ?? 8, area.w, area.d)
    }
    /** The stairs up (area cells of the main room), if the house has an attic. */
    const stairs = () => (levelDef()?.attic ? stairsOf(plan()) : null)

    // Finishes are items too.
    const registerItems = () => {
      const items = api.registry('items')
      for (const f of finishes.all()) {
        if (items.has(f.id)) continue
        items.register({
          id: f.id,
          name: f.name,
          description: f.kind === 'wall' ? 'Используйте дома, чтобы поклеить.' : 'Используйте дома, чтобы постелить.',
          stack: 1,
          price: f.price,
          icon: { block: f.block },
          tags: ['house:finishes', f.kind === 'wall' ? 'house:wallpapers' : 'house:floorings'],
        })
      }
    }
    api.events.on('content:loaded', registerItems)
    registerItems()
    const blockOf = (finish: string, fallback: string) => finishes.get(finish)?.block ?? fallback

    // --- the rooms: the main one and the attic up the stairs ----------------------------------------
    const inside = () => api.interiors.current === HOME
    /** The room of the house the player is in, or null. */
    const here = (): Room | null => {
      const c = api.interiors.current
      return c === HOME || c === ATTIC ? c : null
    }
    const wallOf = (room: Room) => (room === HOME ? state.value.wall : state.value.atticWall)
    const floorOf = (room: Room) => (room === HOME ? state.value.floor : state.value.atticFloor)
    const heightOf = (room: Room) => (room === HOME ? cfg.wallHeight : cfg.atticWallHeight)
    // Invisible blocks to walk on and into; the rooms kit draws the walls and the floor over them.
    // Under the stairs and the hatch the floor is not one furniture can stand on.
    const columnId = (room: Room, p: RoomPlan, lx: number, lz: number, y: number, stairCell: (lx: number, lz: number) => 'foot' | 'step' | null): string => {
      const F = cfg.floorY
      const kind = p.kindAt(lx, lz)
      if (kind === 'outside' || y < F) return api.world.AIR
      const st = stairCell(lx, lz)
      if (y === F) return st ? 'house:stairs' : blockOf(floorOf(room), 'core:planks')
      if (st === 'step' && y === F + 1) return 'house:stairs'
      if (kind !== 'wall' || y - F > heightOf(room)) return api.world.AIR
      return blockOf(wallOf(room), 'core:planks')
    }
    const surface = (finish: string, kind: 'wall' | 'floor'): FinishDef | undefined => {
      const f = finishes.get(finish)
      return f?.kind === kind ? f : finishes.all().find((x) => x.kind === kind)
    }
    let hatch: ReturnType<typeof hatchModel> | null = null
    const dropShell = () => {
      shell?.dispose()
      shell = null
      hatch?.dispose()
      hatch = null
    }
    const showShell = () => {
      dropShell()
      const room = here()
      if (!room) return
      const p = plan(room)
      const a = areaOf(room)
      const wall = surface(wallOf(room), 'wall')
      const floor = surface(floorOf(room), 'floor')
      const cell = (c: { x: number; z: number }) => ({ x: a.x + c.x, z: a.z + c.z })
      const up = room === HOME ? stairs() : null
      shell = api.services.get('rooms:kit').build({
        box: { x0: a.x + p.x0, z0: a.z + p.z0, w: p.w, d: p.d },
        floorY: cfg.floorY + 1,
        height: heightOf(room),
        doors: room === HOME ? [cell(p.door)] : [],
        windows: windowsOf(p).map(cell),
        look: {
          wall: wall?.look ?? { material: 'house:paper_dots', color: '#f7ecd6' },
          wainscot: wall?.wainscot ?? null,
          floor: floor?.look ?? { material: 'core:planks', color: '#ffffff' },
          trim: cfg.trim,
          door: cfg.door,
          curtain: cfg.curtain,
          mat: cfg.mat,
        },
        // each step its own height
        builtIns: up ? up.steps.map((st) => ({ cells: [cell(st)], body: cfg.stairs, top: cfg.stairsTop, height: st.h })) : [],
      })
      shell.setLights(state.value.lights)
      shell.setCurtains(state.value.curtains)
      if (room === ATTIC) {
        const h = cell(hatchOf(p))
        hatch = hatchModel(api, h.x, cfg.floorY + 1, h.z, cfg)
      }
    }
    /** Where walking takes you out of the room you are in (world cells), set when it is built. */
    let ways: { room: Room; door: { x: number; z: number } | null; up: { x: number; z: number } | null; down: { x: number; z: number } | null } | null = null
    const build = () => {
      // The room's own world starts empty each time you come in: only the room is built.
      const room = here()
      if (!room) return
      const p = plan(room)
      const a = areaOf(room)
      const up = room === HOME ? stairs() : null
      const down = room === ATTIC ? hatchOf(p) : null
      const world = (c: { x: number; z: number } | null | undefined) => (c ? { x: a.x + c.x, z: a.z + c.z } : null)
      ways = { room, door: room === HOME ? world(p.door) : null, up: world(up?.foot), down: world(down) }
      const stairCell = (lx: number, lz: number): 'foot' | 'step' | null => {
        if (down) return lx === down.x && lz === down.z ? 'foot' : null
        if (!up) return null
        for (const st of up.steps) if (st.x === lx && st.z === lz) return st === up.foot ? 'foot' : 'step'
        return null
      }
      const w = api.world
      for (let lz = 0; lz < a.d; lz++)
        for (let lx = 0; lx < a.w; lx++) {
          const X = a.x + lx
          const Z = a.z + lz
          for (let y = 0; y < w.height; y++) {
            const id = columnId(room, p, lx, lz, y, stairCell)
            if (w.getBlock(X, y, Z) !== id) w.setBlock(X, y, Z, id)
          }
        }
      showShell()
    }
    const furnish = () => {
      if (state.value.furnished) return
      set({ furnished: true })
      const p = plan()
      const cx = area.x + p.x0 + Math.floor(p.w / 2)
      const cz = area.z + p.z0 + Math.floor(p.d / 2)
      for (const s of cfg.starter) decor().place(s.piece, s.variant, cx + s.dx, cz + s.dz, 0)
    }
    api.events.on('interior:changed', ({ id }) => {
      if (id !== HOME && id !== ATTIC) {
        ways = null
        return void dropShell() // gone out: the shell goes too
      }
      build()
      if (id === HOME) furnish()
    })
    api.events.on('session:started', () => (here() ? build() : dropShell()))
    api.onDispose(dropShell)
    const entrance = () => {
      const p = plan()
      return { x: area.x + p.spawn.x, y: cfg.floorY + 1, z: area.z + p.spawn.z, rotY: Math.PI }
    }
    const player = () => {
      for (const e of api.entities.world.with('player', 'transform')) return e
      return undefined
    }
    const goOut = (actor: Entity) => {
      if (api.interiors.changing) return
      api.interiors.exit(actor) // out of the door, facing away from it
      api.audio.play('ui:close')
    }
    /** Up the stairs: beside the hatch, facing into the attic. */
    const upstairs = () => {
      const h = hatchOf(plan(ATTIC))
      return { x: atticArea.x + h.x - 0.5, y: cfg.floorY + 1, z: atticArea.z + h.z + 0.5, rotY: -Math.PI / 2 }
    }
    /** Down the stairs: in front of the lowest step, facing away from them. */
    const downstairs = () => {
      const f = stairs()?.foot
      // no stairs any more (the house was made smaller): in by the door
      return f ? { x: area.x + f.x + 0.5, y: cfg.floorY + 1, z: area.z + f.z + 1.5, rotY: 0 } : entrance()
    }
    const climb = (actor: Entity, to: Room) => {
      if (api.interiors.changing) return
      api.interiors.enter(to, actor, to === ATTIC ? upstairs() : downstairs())
      api.audio.play('core:step_wood')
    }
    // Walking onto the door goes out; onto the lowest step, up; onto the hatch, down.
    api.systems.add({
      id: 'door',
      phase: 'update',
      run: () => {
        if (!ways || ways.room !== here()) return
        const pl = player()
        if (!pl) return
        const x = Math.floor(pl.transform.x)
        const z = Math.floor(pl.transform.z)
        if (onCell(ways.door, x, z)) goOut(pl)
        else if (onCell(ways.up, x, z)) climb(pl, ATTIC)
        else if (onCell(ways.down, x, z)) climb(pl, HOME)
      },
    })
    // Lights: dim the room when they're off (after the engine's indoor light).
    api.hooks.tap(
      'light:adjust',
      (st) => {
        if (here() && !state.value.lights) {
          st.ambient *= cfg.dark
          st.sunIntensity *= cfg.dark
        }
        return st
      },
      { priority: 1100 },
    )

    // --- outside: the house and the mailbox --------------------------------------------------------
    const homes = () => [...api.entities.world.with('home', 'transform')]
    const grass = (x: number, zz: number) => {
      const y = api.world.surfaceY(x, zz)
      return y === api.world.ground && api.world.getBlock(x, y - 1, zz) === 'core:grass' && api.world.getBlock(x, y, zz) === api.world.AIR ? y : null
    }
    const plotAt = (x0: number, z0: number): number | null => {
      const base = grass(x0, z0)
      if (base === null) return null
      for (let dz = 0; dz < cfg.size + cfg.frontRows; dz++)
        for (let dx = 0; dx < cfg.size + 1; dx++) {
          const y = grass(x0 + dx, z0 + dz)
          if (y === null || y !== base || api.world.blockerAt(x0 + dx, z0 + dz)) return null
        }
      const r = cfg.clearance
      for (let dz = -r; dz < cfg.size + cfg.frontRows + r; dz++)
        for (let dx = -r; dx < cfg.size + 1 + r; dx++) if ((api.world.blockerAt(x0 + dx, z0 + dz)?.blocker?.w ?? 1) > 1) return null
      return base
    }
    const houseModel = () => ({
      shape: 'voxel' as const,
      ref: levelDef()?.model ?? 'house:house_1',
      size: [cfg.size, 3, cfg.size] as [number, number, number],
      color: '#f7ecd6',
      anchor: 'bottom' as const,
    })
    const placeHouse = () => {
      const cx = Math.floor(api.world.sizeX / 2 - cfg.size / 2)
      const cz = Math.floor(api.world.sizeZ / 2 - cfg.size / 2)
      for (let r = 4; r < api.world.sizeX / 2; r++)
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
            const x0 = cx + dx
            const z0 = cz + dz
            const y = plotAt(x0, z0)
            if (y === null) continue
            for (const e of [...api.entities.world.with('transform')]) {
              const ex = Math.floor(e.transform.x)
              const ez = Math.floor(e.transform.z)
              if (ex >= x0 && ex <= x0 + cfg.size && ez >= z0 && ez < z0 + cfg.size + cfg.frontRows && !e.inventory) api.entities.despawn(e)
            }
            const home = api.entities.spawn({
              name: 'Мой дом',
              transform: { x: x0 + cfg.size / 2, y, z: z0 + cfg.size / 2, rotY: 0 },
              model: houseModel(),
              blocker: { w: cfg.size, d: cfg.size, h: 5 },
              home: {},
            })
            api.entities.spawn({
              name: 'Почтовый ящик',
              transform: { x: x0 + cfg.size + 0.5, y, z: z0 + cfg.size + 0.5, rotY: 0 },
              model: {
                shape: 'voxel',
                ref: 'house:mailbox',
                size: [1, 1, 1],
                color: '#6aa0d8',
                anchor: 'bottom',
              },
              blocker: { w: 1, d: 1, h: 2 },
              blobShadow: { radius: 0.3, opacity: 0.2 },
              mailbox: {},
            })
            return home
          }
      return null
    }
    api.events.on('session:started', () => {
      if (!homes().length && !placeHouse()) api.log.warn('no place for the house')
    })
    const refreshHouse = () => {
      for (const h of homes()) api.render.setModel(h, houseModel())
    }

    // The builders work overnight.
    api.events.on('time:day', ({ dayIndex }) => {
      const s = state.value
      if (s.readyDay < 0 || dayIndex < s.readyDay) return
      const next = levelDef(s.level + 1)
      const before = plan()
      set({ level: next ? s.level + 1 : s.level, readyDay: -1 })
      // pictures and shelves go out with the walls they hang on
      const after = plan()
      for (const e of api.entities.world.with('decor', 'transform')) {
        if (api.interiors.roomAt(e.transform.x, e.transform.z) !== HOME || decor().get(e.decor.piece)?.layer !== 'wall') continue
        const at = moveToWall(before, after, Math.floor(e.transform.x) - area.x, Math.floor(e.transform.z) - area.z)
        if (!at) continue
        e.transform.x = area.x + at.x + 0.5
        e.transform.z = area.z + at.z + 0.5
        api.world.updateBlocker(e)
      }
      refreshHouse()
      if (here()) build()
      if (next)
        api.ui.toast(next.attic ? `Готово: ${next.name}! Наверх — по лестнице у правой стены.` : `Готово: ${next.name}! Комната стала больше.`, { ms: 4000 })
    })

    // --- interactions -----------------------------------------------------------------------------
    const interactions = api.registry('interactions')
    interactions.register({
      id: 'house:enter',
      entity: 'home',
      priority: 50,
      anim: 'none',
      sound: 'ui:open',
      label: 'Войти домой',
      run: (ctx) => api.interiors.enter(HOME, ctx.actor, entrance()),
    })
    interactions.register({
      id: 'house:mailbox',
      entity: 'mailbox',
      priority: 50,
      anim: 'none',
      sound: 'ui:open',
      label: 'Почтовый ящик',
      run: () => void api.ui.open('house:mailbox'),
    })
    const atDoor = (ctx: { x: number; z: number }) => {
      if (!inside()) return false
      const p = plan()
      return ctx.x - area.x === p.door.x && ctx.z - area.z === p.door.z
    }
    interactions.register({
      id: 'house:leave',
      priority: 60,
      anim: 'none',
      label: 'Выйти',
      when: atDoor,
      run: (ctx) => goOut(ctx.actor),
    })
    interactions.register({
      id: 'house:lights',
      button: 'secondary',
      priority: 60,
      anim: 'none',
      sound: 'ui:click',
      label: () => (state.value.lights ? 'Выключить свет' : 'Включить свет'),
      when: atDoor,
      run: () => void set({ lights: !state.value.lights }),
    })
    // the curtains: use a window (the wall cell it is in)
    interactions.register({
      id: 'house:curtains',
      priority: 55,
      anim: 'none',
      sound: 'ui:click',
      label: () => (state.value.curtains ? 'Открыть шторы' : 'Задёрнуть шторы'),
      when: (ctx) => {
        const room = here()
        return !!room && windowsOf(plan(room)).some((c) => c.x === ctx.x - areaOf(room).x && c.z === ctx.z - areaOf(room).z)
      },
      run: () => void set({ curtains: !state.value.curtains }),
    })
    interactions.register({
      id: 'house:finish',
      tool: '#house:finishes',
      priority: 25,
      label: (ctx) => (finishes.get(ctx.held ?? '')?.kind === 'floor' ? 'Постелить пол' : 'Поклеить обои'),
      sound: 'core:dig',
      when: (ctx) => !!here() && !!finishes.get(ctx.held ?? ''),
      run: (ctx) => {
        const f = finishes.get(ctx.held!)
        const room = here()
        if (!f || !room) return false
        const old = f.kind === 'wall' ? wallOf(room) : floorOf(room)
        if (old === f.id) {
          api.ui.toast('Уже так и есть.')
          return false
        }
        inventory().remove(ctx.actor, f.id, 1)
        if (room === ATTIC) set(f.kind === 'wall' ? { atticWall: f.id } : { atticFloor: f.id })
        else set(f.kind === 'wall' ? { wall: f.id } : { floor: f.id })
        inventory().add(ctx.actor, old, 1, { quiet: true }) // the old one comes back
        build()
      },
    })

    api.ui.window({
      id: 'house:mailbox',
      title: 'Почтовый ящик',
      component: () => <Mailbox api={api} state={state} set={set} levelDef={levelDef} />,
    })

    try {
      api.registry('daily:sections').register({
        id: 'house:today',
        order: 42,
        line: () => {
          const s = state.value
          if (s.readyDay >= 0) return { icon: '🏗', text: 'Строители заканчивают дом — к утру он станет больше.' }
          if (s.debt > 0)
            return {
              icon: '🏠',
              text: `Кредит за дом: ${s.debt.toLocaleString('ru-RU')} 🔔. Платить можно у почтового ящика.`,
            }
          return levelDef(s.level + 1) ? null : { icon: '🏠', text: 'Дом построен полностью. Самое время его обставить!' }
        },
      })
    } catch {
      // no daily notes
    }
    try {
      api.registry('tutorial:steps').register({
        id: 'house:tutorial_home',
        order: 78,
        text: 'Найдите свой домик и загляните внутрь.',
        keys: ['player:use'],
        event: 'interior:changed',
        when: (p: { id: string | null }) => p.id === HOME,
      })
    } catch {
      // no tutorial
    }

    try {
      api.registry('tutorial:steps').register({
        id: 'house:tutorial_mailbox',
        order: 96,
        day: 3,
        text: 'У почтового ящика рядом с домом можно взять кредит и расширить дом.',
        keys: ['player:use'],
        event: 'ui:opened',
        when: (p: { id: string }) => p.id === 'house:mailbox',
      })
    } catch {
      // no tutorial
    }

    api.commands.register({
      name: 'house',
      description: 'Дом: house · house in / up / out · house level 2 · house paid',
      usage: '[in | up | out | level N | paid]',
      run: ([what, n]) => {
        const pl = player()
        if (what === 'in' && pl) api.interiors.enter(HOME, pl, entrance())
        if (what === 'up' && pl && levelDef()?.attic) climb(pl, ATTIC)
        if (what === 'out' && pl) api.interiors.exit(pl)
        if (what === 'level' && levelDef(Number(n))) {
          set({ level: Number(n), readyDay: -1 })
          refreshHouse()
          if (here()) build()
        }
        if (what === 'paid') set({ debt: 0 })
        const s = state.value
        return `${levelDef()?.name} (уровень ${s.level}), долг ${s.debt}, обои ${s.wall}, пол ${s.floor}, свет ${s.lights ? 'вкл' : 'выкл'}`
      },
    })
  },
})

// --- the mailbox: the loan ----------------------------------------------------------------------

function Mailbox(props: {
  api: PluginApi
  state: ReadonlySignal<HouseState>
  set: (p: Partial<HouseState>) => void
  levelDef: (n?: number) => LevelDef | undefined
}) {
  const { api } = props
  const s = props.state.value
  const wallet = api.services.get('economy:wallet')
  const bells = wallet.bells.value
  const cur = props.levelDef(s.level)
  const next = props.levelDef(s.level + 1)
  const fmt = (n: number) => n.toLocaleString('ru-RU')
  const pay = (want: number) => {
    const n = payment(want, s.debt, bells)
    if (!n || !wallet.spend(n)) return
    props.set({ debt: s.debt - n })
    api.audio.play('economy:coins')
    if (s.debt - n === 0) api.ui.toast('Кредит выплачен полностью! Теперь дом можно расширить.', { ms: 3500 })
  }
  const build = () => {
    if (!next || s.debt > 0 || s.readyDay >= 0) return
    props.set({ debt: next.cost, readyDay: api.time.dayIndex + 1 })
    api.audio.play('ui:pop')
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: 'min(460px, 86vw)' }}>
      <div>
        <div style={{ fontWeight: 800, fontSize: '16px' }}>{cur?.name ?? 'Дом'}</div>
        <div style={{ fontSize: '13px', color: 'var(--ui-text-soft)' }}>
          Комната {cur?.room.w ?? '?'}×{cur?.room.d ?? '?'} · в кошельке {fmt(bells)} 🔔
        </div>
      </div>
      {s.debt > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div>
            Кредит за дом: <b>{fmt(s.debt)} 🔔</b>. Процентов нет, сроков тоже — платите, когда удобно.
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[1000, 10000].map((n) => (
              <ui.Button key={n} secondary disabled={bells < 1} onClick={() => pay(n)}>
                Внести {fmt(Math.min(n, s.debt))}
              </ui.Button>
            ))}
            <ui.Button disabled={bells < 1} onClick={() => pay(s.debt)}>
              Внести {fmt(Math.min(s.debt, bells))}
            </ui.Button>
          </div>
        </div>
      ) : null}
      {s.readyDay >= 0 ? (
        <div style={{ color: 'var(--ui-accent)', fontWeight: 700 }}>🏗 Строители работают — к утру будет {next?.name.toLowerCase()}.</div>
      ) : next ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div style={{ fontSize: '13px' }}>
            Следующий: <b>{next.name}</b>, комната {next.room.w}×{next.room.d}. Кредит {fmt(next.cost)} 🔔.
            {s.debt > 0 && <div style={{ color: 'var(--ui-text-soft)' }}>Сначала выплатите текущий кредит.</div>}
          </div>
          <ui.Button disabled={s.debt > 0} onClick={build}>
            Расширить
          </ui.Button>
        </div>
      ) : (
        <div style={{ fontSize: '13px', color: 'var(--ui-text-soft)' }}>Это самый большой дом. Обставляйте!</div>
      )}
    </div>
  )
}

/**
 * The hatch in the attic floor: a dark opening in a frame, and the top of the stairs' rails rising
 * out of it at the back.
 */
function hatchModel(api: PluginApi, x: number, y: number, z: number, cfg: Config) {
  const T = api.render.three
  const g = new T.Group()
  const frame = api.render.stylize(new T.MeshLambertMaterial({ color: cfg.stairs.color }))
  const dark = api.render.stylize(new T.MeshLambertMaterial({ color: cfg.hatch.color }))
  const geos = [new T.BoxGeometry(1, 0.04, 1), new T.BoxGeometry(0.82, 0.02, 0.82), new T.BoxGeometry(0.07, 0.75, 0.07), new T.BoxGeometry(0.74, 0.06, 0.06)]
  const add = (geo: number, mat: InstanceType<typeof T.Material>, px: number, py: number, pz: number) => {
    const m = new T.Mesh(geos[geo], mat)
    m.position.set(px, py, pz)
    g.add(m)
  }
  add(0, frame, 0, 0.02, 0)
  add(1, dark, 0, 0.045, 0)
  add(2, frame, -0.37, 0.4, -0.3)
  add(2, frame, 0.37, 0.4, -0.3)
  add(3, frame, 0, 0.72, -0.3)
  g.position.set(x + 0.5, y, z + 0.5)
  api.render.add(g)
  return {
    dispose() {
      g.removeFromParent()
      for (const geo of geos) geo.dispose()
      frame.dispose()
      dark.dispose()
    },
  }
}

const onCell = (c: { x: number; z: number } | null, x: number, z: number) => !!c && c.x === x && c.z === z
