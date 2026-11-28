/**
 * Neighbours' homes you can visit: each villager's house is a room of its own (an 8 × 8 room in the
 * engine's rooms, drawn by the rooms kit), furnished after the neighbour's character — wallpaper,
 * floor and furniture are data (content/villagers/villagers.homes.json5, by personality). Knock when
 * they are in (the `home` activity of their day) and they let you in and wait inside; at night they
 * sleep and the door stays shut. Their furniture is theirs: it can't be taken.
 */
import { z, type Entity, type PluginApi, type RegistryEntry, type Services } from '@sdk'

type Shell = ReturnType<Services['rooms:kit']['build']>

const Surface = z.object({ material: z.string(), color: z.string() })
export const HomeLookSchema = z.looseObject({
  /** The personality this look is for (`villagers:personalities` id). */
  id: z.string(),
  wall: Surface,
  wainscot: Surface.extend({ height: z.number().min(0.1).max(3) }).optional(),
  floor: Surface,
  trim: Surface.default({ material: 'house:painted_wood', color: '#fbf6ee' }),
  curtain: Surface.default({ material: 'house:curtain', color: '#fffaf2' }),
  door: Surface.default({ material: 'core:wood', color: '#e9c9a3' }),
  mat: Surface.default({ material: 'house:doormat', color: '#e8d2ae' }),
  /** Furniture, inner cells from the back left corner (0…5); z = -1 hangs on the back wall. */
  furniture: z.array(z.object({ piece: z.string(), variant: z.string(), x: z.number().int(), z: z.number().int(), rot: z.number().default(0) })).default([]),
})
export type HomeLook = z.infer<typeof HomeLookSchema> & RegistryEntry

declare module '@sdk' {
  interface Registries {
    'villagers:homes': HomeLook
  }
}

/** The room of a neighbour's home: cells across, walls included, its floor level and wall height. */
export const ROOM = 8
const FLOOR = 8
const WALLS = 4

export const roomId = (villagerId: string) => `villagers:home_${villagerId.split(':').pop()}`

export interface Homes {
  /** Into a neighbour's home (they must be in it). */
  enter(actor: Entity, villagerId: string): void
  /** Take a neighbour's furniture away (they moved out). */
  clear(villagerId: string): void
}

export function setupHomes(
  api: PluginApi,
  opts: {
    /** Who can live on the island (`villagers:villagers`). */
    defs: { get(id: string): { name: string; personality: string } | undefined; all(): ReadonlyArray<{ id: string; name: string }> }
    /** The neighbour's body (on the island, or visiting its room). */
    body(villagerId: string): Entity | undefined
    /** Back into their house on the island (hidden: they are at home). */
    sendBack(villagerId: string): void
    furnished(villagerId: string): boolean
    setFurnished(villagerId: string): void
  },
): Homes {
  const looks = api.createRegistry<HomeLook>('villagers:homes', HomeLookSchema as never)
  const owners = new Map<string, string>()
  const defineRooms = () => {
    for (const v of opts.defs.all()) {
      const room = roomId(v.id)
      owners.set(room, v.id)
      api.interiors.define(room, { name: `Дом: ${v.name}`, icon: '🏡' })
    }
  }
  api.events.on('content:loaded', defineRooms)
  defineRooms()

  /** Where the room lies in its world: the ring of walls, the door, the windows, where the host stands. */
  const plan = (room: string) => {
    const a = api.interiors.area(room)
    const x0 = a.x + Math.floor((a.w - ROOM) / 2)
    const z0 = a.z + Math.floor((a.d - ROOM) / 2)
    return {
      x0,
      z0,
      door: { x: x0 + ROOM / 2, z: z0 + ROOM - 1 },
      windows: [
        { x: x0 + 2, z: z0 },
        { x: x0 + ROOM - 3, z: z0 },
        { x: x0, z: z0 + 3 },
        { x: x0 + ROOM - 1, z: z0 + 3 },
      ],
      host: { x: x0 + ROOM / 2 + 0.5, z: z0 + 3.5 },
    }
  }
  const lookOf = (villagerId: string) => looks.get(opts.defs.get(villagerId)?.personality ?? '') ?? looks.all()[0]

  let shell: Shell | null = null
  let here: string | null = null
  const build = (room: string, villagerId: string) => {
    const p = plan(room)
    const w = api.world
    const look = lookOf(villagerId)
    for (let z = p.z0; z < p.z0 + ROOM; z++)
      for (let x = p.x0; x < p.x0 + ROOM; x++) {
        const ring = x === p.x0 || z === p.z0 || x === p.x0 + ROOM - 1 || z === p.z0 + ROOM - 1
        w.setBlock(x, FLOOR, z, 'villagers:floor')
        if (ring) for (let y = FLOOR + 1; y <= FLOOR + WALLS; y++) w.setBlock(x, y, z, 'villagers:wall')
      }
    shell?.dispose()
    shell = null
    if (api.services.has('rooms:kit') && look)
      shell = api.services.get('rooms:kit').build({
        box: { x0: p.x0, z0: p.z0, w: ROOM, d: ROOM },
        floorY: FLOOR + 1,
        height: WALLS,
        doors: [p.door],
        windows: p.windows,
        look: { wall: look.wall, wainscot: look.wainscot ?? null, floor: look.floor, trim: look.trim, door: look.door, curtain: look.curtain, mat: look.mat },
      })
    // their furniture, set up the first time anyone comes in (then it is saved with the island)
    if (!opts.furnished(villagerId) && look && api.services.has('decor:pieces')) {
      opts.setFurnished(villagerId)
      const decor = api.services.get('decor:pieces')
      // floor things first, then what goes on them and on the walls
      const order = { floor: 0, rug: 1, top: 2, wall: 3 } as const
      const layer = (piece: string) => decor.get(piece)?.layer ?? 'floor'
      for (const f of [...look.furniture].sort((a, b) => order[layer(a.piece)] - order[layer(b.piece)]))
        decor.place(f.piece, f.variant, p.x0 + 1 + f.x, p.z0 + 1 + f.z, f.rot, undefined, FLOOR + 1)
    }
    // the host waits in the middle of the room, facing the door
    const body = opts.body(villagerId)
    if (body?.transform) Object.assign(body.transform, { x: p.host.x, y: FLOOR + 1, z: p.host.z, rotY: 0 })
  }

  api.events.on('interior:changed', ({ id }) => {
    const was = here
    here = id && owners.has(id) ? id : null
    if (was && was !== here) {
      shell?.dispose()
      shell = null
      opts.sendBack(owners.get(was)!)
    }
    if (here) build(here, owners.get(here)!)
  })
  api.events.on('session:started', () => {
    const id = api.interiors.current
    here = id && owners.has(id) ? id : null
    if (here) build(here, owners.get(here)!)
  })
  api.onDispose(() => shell?.dispose())

  // out through the door
  const player = () => {
    for (const e of api.entities.world.with('player', 'transform')) return e
    return undefined
  }
  api.systems.add({
    id: 'homeDoor',
    phase: 'update',
    run: () => {
      if (!here || api.interiors.changing) return
      const pl = player()
      if (!pl) return
      const d = plan(here).door
      if (Math.floor(pl.transform.x) === d.x && Math.floor(pl.transform.z) === d.z) {
        api.interiors.exit(pl)
        api.audio.play('ui:close')
      }
    },
  })

  // what a neighbour has at home stays theirs
  api.hooks.tap('decor:canTake', (ok, { entity }) => {
    if (!ok || !entity.transform) return ok
    const room = api.interiors.roomAt(entity.transform.x, entity.transform.z)
    if (room && owners.has(room)) {
      api.ui.toast('Это не ваше — вещи хозяев остаются у них.')
      return false
    }
    return ok
  })

  return {
    enter(actor, villagerId) {
      const room = roomId(villagerId)
      const p = plan(room)
      api.interiors.enter(room, actor, { x: p.door.x + 0.5, y: FLOOR + 1, z: p.door.z - 0.5, rotY: Math.PI })
    },
    clear(villagerId) {
      const room = roomId(villagerId)
      for (const e of [...api.entities.world.with('decor', 'transform')])
        if (api.interiors.roomAt(e.transform.x, e.transform.z) === room) api.entities.despawn(e)
    },
  }
}
