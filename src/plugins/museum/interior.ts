/**
 * The museum hall you walk around in: built from the text plan in `museum:layouts` inside a room
 * reserved by the engine (`api.interiors`). Pedestals hold tanks, terrariums and fossils for
 * everything donated; empty slots show a placard. The reception desk opens the donation window,
 * the door mat takes you back outside.
 */
import { z, type Entity, type PluginApi, type RegistryEntry, type Services } from '@sdk'
import { floorBlock, parseHall, type Cell, type HallPlan } from './layout'

type Three = PluginApi['render']['three']
type Obj = InstanceType<Three['Object3D']>
type SpeciesDef = NonNullable<ReturnType<Services['collection:catalog']['get']>>

export const HALL_ID = 'museum:hall'

export interface LayoutDef extends RegistryEntry {
  rows: string[]
  /** Floor block per layout character ('.' = default). */
  floors: Record<string, string>
  blocks: { wall: string; wainscot: string; glass: string; pedestal: string; desk: string }
  props: { tank: string; terrarium: string; placard: string; plant: string; lamp: string; bell: string }
  curator: string
}

export const LayoutSchema = z.looseObject({
  id: z.string(),
  tags: z.array(z.string()).optional(),
  rows: z.array(z.string()).min(3),
  floors: z.record(z.string(), z.string()).default({
    '.': 'museum:parquet',
    a: 'museum:carpet_fish',
    b: 'museum:carpet_bugs',
    c: 'museum:carpet_fossils',
    O: 'museum:carpet_fossils',
    D: 'museum:mat',
  }),
  blocks: z
    .object({
      wall: z.string().default('museum:wall'),
      wainscot: z.string().default('museum:wainscot'),
      glass: z.string().default('museum:glass'),
      pedestal: z.string().default('museum:pedestal'),
      desk: z.string().default('museum:desk'),
    })
    .prefault({}),
  props: z
    .object({
      tank: z.string().default('museum:tank'),
      terrarium: z.string().default('museum:terrarium'),
      placard: z.string().default('museum:placard'),
      plant: z.string().default('museum:plant'),
      lamp: z.string().default('museum:lamp'),
      bell: z.string().default('museum:bell'),
    })
    .prefault({}),
  /** Rig of the curator standing at the C cells. */
  curator: z.string().default('museum:curator'),
})

export const HallConfig = z
  .object({
    /** Floor level of the room (the player stands one above). */
    floorY: z.number().int().min(2).max(24).default(8).meta({ label: 'floor y', step: 1 }),
    wallHeight: z.number().int().min(1).max(8).default(4).meta({ label: 'wall height', step: 1 }),
    /** Exhibits are scaled to fit this many voxels (1/16 block). */
    fitFish: z.number().min(4).max(24).default(11).meta({ label: 'fit fish', step: 0.5 }),
    fitBug: z.number().min(4).max(24).default(9).meta({ label: 'fit bug', step: 0.5 }),
    fitFossil: z.number().min(4).max(32).default(14).meta({ label: 'fit fossil', step: 0.5 }),
    waterColor: z.string().default('#8fd6ef').meta({ color: true }),
    waterOpacity: z.number().min(0).max(1).default(0.32).meta({ label: 'water opacity', step: 0.01 }),
    swimSpeed: z.number().min(0).max(3).default(0.6).meta({ label: 'exhibit swim', step: 0.05 }),
    curatorScale: z.number().min(0.3).max(3).default(1.25).meta({ label: 'curator scale', step: 0.05 }),
  })
  .prefault({})
type HallConfig = z.infer<typeof HallConfig>

interface Exhibit {
  obj: Obj
  kind: 'fish' | 'bug' | 'fossil' | 'still'
  x: number
  y: number
  z: number
  facing: number
  phase: number
}

export interface Hall {
  plan(): HallPlan | null
  /** Where the player appears inside (world coordinates). */
  entrance(): { x: number; y: number; z: number; rotY: number } | null
  /** Build the room's voxels (on the way in, or loading a save made inside). */
  build(): void
  /** Exhibits changed (a donation): rebuild them next time they are seen. */
  refresh(): void
  /** The curator is speaking (nods while text appears). */
  setTalking(on: boolean): void
  /** What is on display in a world cell, if it is a slot. */
  slotAt(x: number, z: number): { kind: 'fish' | 'bug' | 'fossil'; species?: SpeciesDef } | null
}

export function setupHall(api: PluginApi, cfg: HallConfig, opts: { donated: (id: string) => boolean; onDesk: (actor: Entity) => void }): Hall {
  const T = api.render.three
  const layouts = api.createRegistry<LayoutDef>('museum:layouts', LayoutSchema as never)
  const catalog = () => api.services.get('collection:catalog')
  const area = api.interiors.area(HALL_ID)
  const layout = () => layouts.get(HALL_ID) ?? undefined
  let plan: HallPlan | null = null
  const getPlan = () => {
    const l = layout()
    if (!l) return null
    try {
      plan ??= parseHall(l.rows)
    } catch (e) {
      api.log.error(String(e))
      return null
    }
    return plan
  }
  // Editing the layout file rebuilds the hall live (dev hot reload).
  let live = false
  let rebuildRoom = false
  api.events.on('session:started', () => (live = true))
  layouts.onChange(() => {
    plan = null
    rebuildRoom = live && inside()
  })
  const inside = () => api.interiors.current === HALL_ID
  const local = (x: number, z: number) => ({ x: x - area.x, z: z - area.z })
  const wx = (c: Cell) => area.x + c.x + 0.5
  const wz = (c: Cell) => area.z + c.z + 0.5

  // --- voxels -----------------------------------------------------------------------------------
  const build = () => {
    const l = layout()
    const p = getPlan()
    if (!l || !p) return
    const w = api.world
    const F = cfg.floorY
    const set = (x: number, y: number, z: number, id: string) => {
      if (w.getBlock(x, y, z) !== id) w.setBlock(x, y, z, id)
    }
    for (let z = 0; z < area.d; z++) {
      for (let x = 0; x < area.w; x++) {
        const X = area.x + x
        const Z = area.z + z
        const ch = x < p.width && z < p.depth ? p.at(x, z) : ' '
        // Below the floor the room keeps the sea it stands in, like the columns around it — an
        // emptied hole would show the sides of the neighbouring water from outside.
        const refX = area.x + area.w < w.sizeX ? area.x + area.w : area.x - 1
        for (let y = 0; y < F; y++) if (w.getBlock(X, y, Z) === w.AIR) set(X, y, Z, w.getBlock(refX, y, Z))
        for (let y = F; y < w.height; y++) {
          let id = w.AIR
          if (ch !== ' ') {
            if (y === F) id = floorBlock(ch, l.floors)
            else if (y > F) {
              const h = y - F
              if (ch === '#' || ch === 'w' || ch === '=') id = wallBlock(l, ch, h, near(x, z, p))
              else if (h === 1 && (ch === 'F' || ch === 'B' || ch === 'O')) id = l.blocks.pedestal
              else if (h === 1 && ch === 'R') id = l.blocks.desk
              else if (h === 1 && ch === 'C') id = floorBlock('.', l.floors) // a little stage behind the desk
            }
          }
          set(X, y, Z, id)
        }
      }
    }
    wallsYaw = api.render.camera.targetYaw
    dirty = true
  }

  // Walls on the side facing the camera stay low (a cutaway, like a dollhouse); they follow Q/E.
  const near = (x: number, z: number, p: HallPlan) => {
    const yaw = (api.render.camera.targetYaw * Math.PI) / 180
    const cx = Math.sin(yaw)
    const cz = Math.cos(yaw)
    const nx = x === 0 ? -1 : x === p.width - 1 ? 1 : 0
    const nz = z === 0 ? -1 : z === p.depth - 1 ? 1 : 0
    return nx * cx + nz * cz > 0.01
  }
  const wallBlock = (l: LayoutDef, ch: string, h: number, isNear: boolean) => {
    if (h > cfg.wallHeight) return api.world.AIR
    if (h === 1) return l.blocks.wainscot
    if (ch === '=' || isNear) return api.world.AIR
    return ch === 'w' && (h === 2 || h === 3) ? l.blocks.glass : l.blocks.wall
  }
  let wallsYaw = NaN
  const rebuildWalls = () => {
    const l = layout()
    const p = getPlan()
    wallsYaw = api.render.camera.targetYaw
    if (!l || !p) return
    for (let z = 0; z < p.depth; z++)
      for (let x = 0; x < p.width; x++) {
        const ch = p.at(x, z)
        if (ch !== '#' && ch !== 'w' && ch !== '=') continue
        for (let h = 2; h <= cfg.wallHeight; h++) {
          const id = wallBlock(l, ch, h, near(x, z, p))
          const X = area.x + x
          const Z = area.z + z
          if (api.world.getBlock(X, cfg.floorY + h, Z) !== id) api.world.setBlock(X, cfg.floorY + h, Z, id)
        }
      }
  }

  // Slots, decor and the desk can't be walked into (a pedestal is one block: it would be climbable).
  api.hooks.tap('movement:blocked', (b, { x, y, z }) => {
    if (b) return b
    const p = getPlan()
    if (!p || x < area.x || z < area.z || x >= area.x + p.width || z >= area.z + p.depth) return false
    const l = local(x, z)
    return p.blocked.has(`${l.x},${l.z}`) && y > cfg.floorY && y <= cfg.floorY + cfg.wallHeight
  })

  // --- exhibits -----------------------------------------------------------------------------------
  const group = api.render.add(new T.Group())
  group.visible = inside()
  // The hall exists only while you're in it (outside, its corner of the world is open sea).
  api.events.on('interior:changed', ({ id }) => {
    group.visible = id === HALL_ID
    if (group.visible) build()
  })
  const waterGeo = new T.BoxGeometry(0.76, 0.5, 0.76)
  const waterMat = api.render.stylize(new T.MeshLambertMaterial({ color: cfg.waterColor, transparent: true, opacity: cfg.waterOpacity, depthWrite: false }))
  api.config.onChange(() => {
    waterMat.color.set(cfg.waterColor)
    waterMat.opacity = cfg.waterOpacity
    dirty = true
  })
  api.onDispose(() => (waterGeo.dispose(), waterMat.dispose()))
  let exhibits: Exhibit[] = []
  let dirty = true
  let built = 0 // bumps on each rebuild: async model fits from an older rebuild are dropped

  const slotSpecies = (kind: 'fish' | 'bug' | 'fossil') => catalog().all(kind)
  const fitModel = (id: string, fit: number, parent: Obj, at: { x: number; y: number; z: number }, rotY: number, gen: number): Obj => {
    const holder = new T.Group()
    holder.position.set(at.x, at.y, at.z)
    holder.rotation.y = rotY
    parent.add(holder)
    void api.render.modelInfo(id).then((info) => {
      if (!info || gen !== built) return
      const longest = Math.max(info.size[0], info.size[1], info.size[2])
      holder.add(api.render.voxelModel(id, { scale: info.scale * Math.min(1, fit / longest) }))
    })
    return holder
  }

  const rebuildExhibits = () => {
    dirty = false
    built++
    group.clear()
    exhibits = []
    const l = layout()
    const p = getPlan()
    if (!l || !p) return
    const top = cfg.floorY + 2 // on the pedestal
    const center = { x: area.x + p.width / 2, z: area.z + p.depth / 2 }
    const facing = (c: Cell) => Math.atan2(center.x - wx(c), center.z - wz(c))
    const still = (id: string, c: Cell, y: number, rot = facing(c)) => {
      const o = api.render.voxelModel(id)
      o.position.set(wx(c), y, wz(c))
      o.rotation.y = rot
      group.add(o)
    }
    for (const kind of ['fish', 'bug', 'fossil'] as const) {
      const list = slotSpecies(kind)
      p.slots[kind].forEach((c, i) => {
        const s = list[i]
        const rot = facing(c)
        if (!s || !opts.donated(s.id)) {
          still(l.props.placard, c, top, rot)
          return
        }
        if (kind === 'fish') {
          still(l.props.tank, c, top, rot)
          const water = new T.Mesh(waterGeo, waterMat)
          water.position.set(wx(c), top + 0.32, wz(c))
          group.add(water)
          const obj = fitModel(s.model, cfg.fitFish, group, { x: wx(c), y: top + 0.18, z: wz(c) }, rot, built)
          exhibits.push({ obj, kind, x: wx(c), y: top + 0.18, z: wz(c), facing: rot, phase: i * 1.7 })
        } else if (kind === 'bug') {
          still(l.props.terrarium, c, top, rot)
          const obj = fitModel(s.model, cfg.fitBug, group, { x: wx(c), y: top + 0.14, z: wz(c) }, rot, built)
          exhibits.push({ obj, kind, x: wx(c), y: top + 0.14, z: wz(c), facing: rot, phase: i * 2.3 })
        } else {
          fitModel(s.model, cfg.fitFossil, group, { x: wx(c), y: top, z: wz(c) }, rot + 0.5, built)
        }
      })
    }
    for (const d of p.decor) still(d.kind === 'plant' ? l.props.plant : l.props.lamp, d, cfg.floorY + 1, 0)
    const bellAt = p.desks[0]
    if (bellAt) still(l.props.bell, bellAt, cfg.floorY + 2, 0)
    curator = null
    if (p.curator) {
      curator = api.render.rigModel(l.curator)
      curator.position.set(area.x + p.curator.x, cfg.floorY + 2, area.z + p.curator.z)
      curator.scale.setScalar(cfg.curatorScale)
      group.add(curator)
    }
  }
  let curator: Obj | null = null
  let talking = false

  let time = 0
  api.systems.add({
    id: 'hall',
    phase: 'render',
    run: ({ dt }) => {
      if (rebuildRoom) {
        rebuildRoom = false
        build()
      }
      if (!inside()) return
      if (api.render.camera.targetYaw !== wallsYaw) rebuildWalls()
      if (dirty) rebuildExhibits()
      time += dt
      for (const e of exhibits) {
        const t = time * cfg.swimSpeed + e.phase
        if (e.kind === 'fish') {
          // back and forth across the tank, turning at the ends
          const s = Math.sin(t)
          e.obj.position.set(e.x + Math.sin(e.facing + Math.PI / 2) * s * 0.18, e.y + Math.sin(t * 2.3) * 0.03, e.z + Math.cos(e.facing + Math.PI / 2) * s * 0.18)
          e.obj.rotation.y = e.facing + (Math.cos(t) >= 0 ? 0 : Math.PI)
        } else if (e.kind === 'bug') {
          e.obj.position.y = e.y + Math.max(0, Math.sin(t * 1.3)) * 0.05
          e.obj.rotation.y = e.facing + Math.sin(t * 0.4) * 0.6
        }
      }
      // the curator breathes, turns to the player and nods while talking
      if (curator) {
        const pl = player()
        if (pl) {
          const want = Math.atan2(pl.transform.x - curator.position.x, pl.transform.z - curator.position.z)
          const d = Math.atan2(Math.sin(want - curator.rotation.y), Math.cos(want - curator.rotation.y))
          curator.rotation.y += d * Math.min(1, dt * 5)
        }
        const body = curator.getObjectByName('body')
        const head = curator.getObjectByName('head')
        if (body) body.scale.y = 1 + Math.sin(time * 2.2) * 0.025
        if (head) {
          head.rotation.x = talking ? Math.sin(time * 9) * 0.08 + 0.05 : Math.sin(time * 0.7) * 0.03
          head.rotation.z = talking ? 0 : Math.sin(time * 0.5) * 0.08
        }
      }
    },
  })

  // --- inside: going out, the desk, looking at exhibits -----------------------------------------
  const player = () => {
    for (const e of api.entities.world.with('player', 'transform')) return e
    return undefined
  }
  api.systems.add({
    id: 'hallDoor',
    phase: 'update',
    run: () => {
      if (!inside()) return
      const p = getPlan()
      const pl = player()
      if (!p || !pl) return
      const l = local(Math.floor(pl.transform.x), Math.floor(pl.transform.z))
      if (p.doors.some((d) => d.x === l.x && d.z === l.z)) {
        api.interiors.exit(pl)
        pl.transform.rotY += Math.PI // turn away from the door
        api.audio.play('ui:close')
      }
    },
  })

  const slotAt = (x: number, z: number): ReturnType<Hall['slotAt']> => {
    const p = getPlan()
    if (!p) return null
    const l = local(x, z)
    for (const kind of ['fish', 'bug', 'fossil'] as const) {
      const i = p.slots[kind].findIndex((c) => c.x === l.x && c.z === l.z)
      if (i < 0) continue
      const s = slotSpecies(kind)[i]
      return { kind, species: s && opts.donated(s.id) ? s : undefined }
    }
    return null
  }
  const interactions = api.registry('interactions')
  interactions.register({
    id: 'museum:look',
    block: '#museum:displays',
    priority: 60,
    anim: 'none',
    label: (ctx) => {
      const s = slotAt(ctx.x, ctx.z)
      return s?.species ? `Посмотреть: ${s.species.name}` : 'Пустая витрина'
    },
    when: (ctx) => inside() && !!slotAt(ctx.x, ctx.z),
    run: (ctx) => {
      const s = slotAt(ctx.x, ctx.z)
      if (!s) return false
      api.ui.toast(s.species ? `${s.species.name}. ${s.species.description ?? ''}` : 'Здесь пока пусто. Подарите музею находку у стойки.', { ms: 3600 })
    },
  })
  interactions.register({
    id: 'museum:desk',
    block: '#museum:desks',
    priority: 60,
    anim: 'none',
    sound: 'ui:pop',
    label: 'Поговорить со смотрительницей',
    when: () => inside(),
    run: (ctx) => opts.onDesk(ctx.actor),
  })

  return {
    plan: getPlan,
    entrance: () => {
      const p = getPlan()
      return p ? { x: area.x + p.spawn.x, y: cfg.floorY + 1, z: area.z + p.spawn.z, rotY: Math.PI } : null
    },
    build,
    refresh: () => void (dirty = true),
    setTalking: (on) => void (talking = on),
    slotAt,
  }
}
