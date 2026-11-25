/**
 * Your house. It stands near the middle of a new island with a mailbox in front; step in and the
 * room is yours to furnish (decor pieces work inside: furniture, rugs, things on tables, pictures on
 * walls). Wallpapers and floors are items you use inside. The mailbox handles the house loan: take
 * it to grow the house (the builders finish overnight), pay it back whenever you like.
 * Levels and finishes are data: content/house/house.levels.json5, house.finishes.json5.
 */
import { definePlugin, signal, ui, z, type Entity, type PluginApi, type ReadonlySignal, type RegistryEntry } from '@sdk'
import { nearWall, payment, planRoom, type RoomPlan } from './room'

export const HOME = 'house:home'

export interface LevelDef extends RegistryEntry {
  level: number
  name: string
  model: string
  room: { w: number; d: number }
  cost: number
}

export interface FinishDef extends RegistryEntry {
  kind: 'wall' | 'floor'
  name: string
  block: string
  price: number
}

interface HouseState {
  level: number
  debt: number
  /** Day the next level is ready (-1 = nothing being built). */
  readyDay: number
  wall: string
  floor: string
  lights: boolean
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
  baseboard: z.string().default('house:baseboard'),
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
  dependsOn: ['items', 'decor', 'economy'],
  // placed after the museum, the shop and the sell box: the house takes the next free plot
  optionalDependsOn: ['museum', 'shop', 'nature', 'garden', 'tutorial', 'daily'],

  setup(api) {
    const cfg = api.config.define(Config)
    const levels = api.createRegistry<LevelDef>(
      'house:levels',
      z.looseObject({ id: z.string(), level: z.number().int(), name: z.string(), model: z.string(), room: z.object({ w: z.number().int(), d: z.number().int() }), cost: z.number().int().min(0) }) as never,
    )
    const finishes = api.createRegistry<FinishDef>(
      'house:finishes',
      z.looseObject({ id: z.string(), kind: z.enum(['wall', 'floor']), name: z.string(), block: z.string(), price: z.number().int().min(0).default(500) }) as never,
    )
    api.components.define('home', z.object({}))
    api.components.define('mailbox', z.object({}))
    const area = api.interiors.area(HOME)
    const inventory = () => api.services.get('items:inventory')
    const decor = () => api.services.get('decor:pieces')

    const fresh = (): HouseState => ({ level: 1, debt: 0, readyDay: -1, wall: cfg.wall, floor: cfg.floor, lights: true, furnished: false })
    const state = signal<HouseState>(fresh())
    const set = (patch: Partial<HouseState>) => (state.value = { ...state.value, ...patch })
    api.save.register<HouseState>({ version: 1, save: () => state.value, load: (d) => (state.value = { ...fresh(), ...d }) })
    api.services.provide('house:info', { level: () => state.value.level, debt: () => state.value.debt })

    const levelDef = (n = state.value.level) => levels.all().find((l) => l.level === n)
    const plan = (): RoomPlan => {
      const l = levelDef()
      return planRoom(l?.room.w ?? 8, l?.room.d ?? 8, area.w, area.d)
    }

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

    // --- the room -------------------------------------------------------------------------------
    const inside = () => api.interiors.current === HOME
    let wallsYaw = NaN
    const columnId = (p: RoomPlan, lx: number, lz: number, y: number): string => {
      const F = cfg.floorY
      const kind = p.kindAt(lx, lz)
      if (kind === 'outside' || y < F) return api.world.AIR
      if (y === F) return blockOf(state.value.floor, 'core:planks')
      if (kind !== 'wall') return api.world.AIR
      const h = y - F
      if (h > cfg.wallHeight) return api.world.AIR
      if (h === 1) return cfg.baseboard
      return nearWall(p.outward(lx, lz), api.render.camera.targetYaw) ? api.world.AIR : blockOf(state.value.wall, 'core:planks')
    }
    const build = () => {
      // Only the room: nothing around or under it (while you're in, only this corner is drawn; on
      // the way out the engine gives it back to the sea).
      const p = plan()
      const w = api.world
      for (let lz = 0; lz < area.d; lz++)
        for (let lx = 0; lx < area.w; lx++) {
          const X = area.x + lx
          const Z = area.z + lz
          for (let y = 0; y < w.height; y++) {
            const id = columnId(p, lx, lz, y)
            if (w.getBlock(X, y, Z) !== id) w.setBlock(X, y, Z, id)
          }
        }
      wallsYaw = api.render.camera.targetYaw
    }
    const rebuildWalls = () => {
      const p = plan()
      for (let lz = 0; lz < area.d; lz++)
        for (let lx = 0; lx < area.w; lx++) {
          if (p.kindAt(lx, lz) !== 'wall') continue
          for (let h = 1; h <= cfg.wallHeight; h++) {
            const id = columnId(p, lx, lz, cfg.floorY + h)
            if (api.world.getBlock(area.x + lx, cfg.floorY + h, area.z + lz) !== id) api.world.setBlock(area.x + lx, cfg.floorY + h, area.z + lz, id)
          }
        }
      wallsYaw = api.render.camera.targetYaw
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
      if (id !== HOME) return
      build()
      furnish()
    })
    api.events.on('session:started', () => inside() && build())
    api.systems.add({
      id: 'room',
      phase: 'render',
      run: () => {
        if (inside() && api.render.camera.targetYaw !== wallsYaw) rebuildWalls()
      },
    })
    const entrance = () => {
      const p = plan()
      return { x: area.x + p.spawn.x, y: cfg.floorY + 1, z: area.z + p.spawn.z, rotY: Math.PI }
    }
    const player = () => {
      for (const e of api.entities.world.with('player', 'transform')) return e
      return undefined
    }
    const goOut = (actor: Entity) => {
      api.interiors.exit(actor)
      actor.transform!.rotY += Math.PI // face away from the door
      api.audio.play('ui:close')
    }
    // Walking onto the door goes out.
    api.systems.add({
      id: 'door',
      phase: 'update',
      run: () => {
        if (!inside()) return
        const pl = player()
        if (!pl) return
        const p = plan()
        if (Math.floor(pl.transform.x) - area.x === p.door.x && Math.floor(pl.transform.z) - area.z === p.door.z) goOut(pl)
      },
    })
    // Lights: dim the room when they're off (after the engine's indoor light).
    api.hooks.tap(
      'light:adjust',
      (st) => {
        if (inside() && !state.value.lights) {
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
      return y > 0 && api.world.getBlock(x, y - 1, zz) === 'core:grass' && api.world.getBlock(x, y, zz) === api.world.AIR ? y : null
    }
    const plotAt = (x0: number, z0: number): number | null => {
      const base = grass(x0, z0)
      if (base === null) return null
      for (let dz = 0; dz < cfg.size + cfg.frontRows; dz++)
        for (let dx = 0; dx < cfg.size + 1; dx++) {
          const y = grass(x0 + dx, z0 + dz)
          if (y === null || (dz < cfg.size ? y !== base : Math.abs(y - base) > 1) || api.world.blockerAt(x0 + dx, z0 + dz)) return null
        }
      const r = cfg.clearance
      for (let dz = -r; dz < cfg.size + cfg.frontRows + r; dz++)
        for (let dx = -r; dx < cfg.size + 1 + r; dx++) if ((api.world.blockerAt(x0 + dx, z0 + dz)?.blocker?.w ?? 1) > 1) return null
      return base
    }
    const houseModel = () => ({ shape: 'voxel' as const, ref: levelDef()?.model ?? 'house:house_1', size: [cfg.size, 3, cfg.size] as [number, number, number], color: '#f7ecd6', anchor: 'bottom' as const })
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
              model: { shape: 'voxel', ref: 'house:mailbox', size: [1, 1, 1], color: '#6aa0d8', anchor: 'bottom' },
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
      set({ level: next ? s.level + 1 : s.level, readyDay: -1 })
      refreshHouse()
      if (inside()) build()
      if (next) api.ui.toast(`Готово: ${next.name}! Комната стала больше.`, { ms: 4000 })
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
    interactions.register({
      id: 'house:finish',
      tool: '#house:finishes',
      priority: 25,
      label: (ctx) => (finishes.get(ctx.held ?? '')?.kind === 'floor' ? 'Постелить пол' : 'Поклеить обои'),
      sound: 'core:dig',
      when: (ctx) => inside() && !!finishes.get(ctx.held ?? ''),
      run: (ctx) => {
        const f = finishes.get(ctx.held!)
        if (!f) return false
        const old = f.kind === 'wall' ? state.value.wall : state.value.floor
        if (old === f.id) {
          api.ui.toast('Уже так и есть.')
          return false
        }
        inventory().remove(ctx.actor, f.id, 1)
        set(f.kind === 'wall' ? { wall: f.id } : { floor: f.id })
        inventory().add(ctx.actor, old, 1, { quiet: true }) // the old one comes back
        build()
      },
    })

    api.ui.window({ id: 'house:mailbox', title: 'Почтовый ящик', component: () => <Mailbox api={api} state={state} set={set} levelDef={levelDef} /> })

    try {
      api.registry('daily:sections').register({
        id: 'house:today',
        order: 42,
        line: () => {
          const s = state.value
          if (s.readyDay >= 0) return { icon: '🏗', text: 'Строители заканчивают дом — к утру он станет больше.' }
          if (s.debt > 0) return { icon: '🏠', text: `Кредит за дом: ${s.debt.toLocaleString('ru-RU')} 🔔. Платить можно у почтового ящика.` }
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
        keys: ['Space'],
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
        keys: ['Space'],
        event: 'ui:opened',
        when: (p: { id: string }) => p.id === 'house:mailbox',
      })
    } catch {
      // no tutorial
    }

    api.commands.register({
      name: 'house',
      description: 'Дом: house · house in / out · house level 2 · house paid',
      usage: '[in | out | level N | paid]',
      run: ([what, n]) => {
        const pl = player()
        if (what === 'in' && pl) api.interiors.enter(HOME, pl, entrance())
        if (what === 'out' && pl) api.interiors.exit(pl)
        if (what === 'level' && levelDef(Number(n))) {
          set({ level: Number(n), readyDay: -1 })
          refreshHouse()
          if (inside()) build()
        }
        if (what === 'paid') set({ debt: 0 })
        const s = state.value
        return `${levelDef()?.name} (уровень ${s.level}), долг ${s.debt}, обои ${s.wall}, пол ${s.floor}, свет ${s.lights ? 'вкл' : 'выкл'}`
      },
    })
  },
})

// --- the mailbox: the loan ----------------------------------------------------------------------

function Mailbox(props: { api: PluginApi; state: ReadonlySignal<HouseState>; set: (p: Partial<HouseState>) => void; levelDef: (n?: number) => LevelDef | undefined }) {
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
