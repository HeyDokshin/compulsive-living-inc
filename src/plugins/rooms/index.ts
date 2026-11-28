/**
 * Rooms kit: the look of interiors, shared by every room (your house, the museum…). A room owner
 * still builds its voxels — invisible blocks to walk on and into — and asks the kit for the shell
 * drawn over them: papered walls with wainscot, baseboards and cornices, floors of real materials
 * that darken towards the walls, windows with the sky of the hour behind them (stars at night, rain
 * running down the glass), curtains, sills, light falling through the windows with dust drifting in
 * it, wall lamps that glow in the evening, a door with its frame and a mat. Walls between the room and
 * the camera stay low, like a dollhouse, and follow the camera round.
 */
import { definePlugin, z, type PluginApi } from '@sdk'
import { MeshBuilder } from './geometry'
import { dayBlend, facesCamera, floorShade, planWalls, wallPieces, type RoomBox, type WallRun } from './shell'

export type { RoomBox } from './shell'

/** A surface: a procedural material (`materials` registry) tinted with a color. */
export interface Surface {
  material: string
  color: string
}

export interface ShellLook {
  wall: Surface
  /** Panelling on the lower part of the walls (null: wallpaper down to the baseboard). */
  wainscot: (Surface & { height: number }) | null
  floor: Surface
  /** Baseboards, cornices, frames, sills, wall tops. */
  trim: Surface
  door: Surface
  curtain: Surface | null
  mat: Surface
}

export interface ShellSpec {
  box: RoomBox
  /** Y of the floor surface the room stands on. */
  floorY: number
  /** Wall height above the floor. */
  height: number
  doors: ReadonlyArray<{ x: number; z: number }>
  windows: ReadonlyArray<{ x: number; z: number }>
  look: ShellLook
  /** A floor surface per cell (e.g. carpets of a museum hall), default `look.floor`. */
  floorAt?: (x: number, z: number) => Surface | null
  /** Built-in furniture standing on cells: plinths and pedestals, counters — a body with a moulded
   * base and a top that overhangs a little (neighbouring cells join into one piece). */
  builtIns?: ReadonlyArray<BuiltIn>
}

export interface BuiltIn {
  cells: ReadonlyArray<{ x: number; z: number }>
  body: Surface
  top: Surface
  /** Top height above the floor. */
  height: number
}

export interface Shell {
  /** Room lights on (lamps glow, the room is warm at night) or off. */
  setLights(on: boolean): void
  /** Curtains drawn across the windows (they glide; the light on the floor fades) or open. */
  setCurtains(closed: boolean): void
  dispose(): void
}

export interface RoomsKit {
  /** Draw a room's shell (until `dispose`). */
  build(spec: ShellSpec): Shell
}

declare module '@sdk' {
  interface Services {
    'rooms:kit': RoomsKit
  }
}

const Hex = z.string()
const Key = z.object({ h: z.number().min(0).max(24), color: Hex, light: z.number().min(0).max(2) })
const Config = z.object({
  /** Wall slab thickness, door and window heights, trims (blocks). */
  thick: z.number().min(0.1).max(0.9).default(0.32).meta({ step: 0.01 }),
  lowHeight: z.number().min(0.1).max(2).default(0.55).meta({ label: 'cutaway wall height', step: 0.05 }),
  doorTop: z.number().min(1.5).max(3.5).default(2.35).meta({ label: 'door top', step: 0.05 }),
  sill: z.number().min(0.3).max(2).default(1.05).meta({ step: 0.05 }),
  windowTop: z.number().min(1.5).max(3.8).default(2.65).meta({ label: 'window top', step: 0.05 }),
  baseboard: z.number().min(0).max(0.5).default(0.17).meta({ step: 0.01 }),
  cornice: z.number().min(0).max(0.5).default(0.14).meta({ step: 0.01 }),
  trimDepth: z.number().min(0.01).max(0.2).default(0.05).meta({ label: 'trim depth', step: 0.005 }),
  frame: z.number().min(0.02).max(0.3).default(0.1).meta({ step: 0.01 }),
  /** Material repeats per block on walls, and on floors. */
  tiles: z.number().min(0.1).max(4).default(0.5).meta({ step: 0.05 }),
  floorTiles: z.number().min(0.1).max(4).default(1).meta({ label: 'floor tiles', step: 0.05 }),
  textureSize: z.number().int().min(64).max(1024).default(512).meta({ label: 'texture size', step: 64 }),
  /** Corners and the floor along the walls get darker (0 off … 1 strong), over this many blocks. */
  floorShade: z.number().min(0).max(1).default(0.32).meta({ label: 'floor shade', step: 0.01 }),
  floorShadeReach: z.number().min(0.2).max(4).default(1.4).meta({ label: 'floor shade reach', step: 0.1 }),
  /** The sky behind the windows and the light through them along the day (wraps round midnight). */
  sky: z.array(Key).default([
    { h: 0, color: '#1d2850', light: 0.12 },
    { h: 5, color: '#2a3766', light: 0.1 },
    { h: 6.5, color: '#f2b48e', light: 0.55 },
    { h: 8.5, color: '#a9dcf6', light: 0.9 },
    { h: 15.5, color: '#9fd6f4', light: 0.95 },
    { h: 18, color: '#f6a676', light: 0.75 },
    { h: 19.5, color: '#6b4f86', light: 0.25 },
    { h: 21, color: '#1d2850', light: 0.12 },
  ]),
  /** Light falling through the windows: color by day and by night, strength. */
  sunlight: Hex.default('#fff1cf').meta({ color: true }),
  moonlight: Hex.default('#9fb6ff').meta({ color: true }),
  lightPool: z.number().min(0).max(1).default(0.42).meta({ label: 'light pool', step: 0.01 }),
  beam: z.number().min(0).max(1).default(0.14).meta({ step: 0.01 }),
  motes: z.number().int().min(0).max(200).default(36).meta({ label: 'dust motes per window', step: 1 }),
  /** Lamps on the walls: their glow and the warmth of the room in the evening. */
  lamp: Hex.default('#ffc978').meta({ color: true }),
  lampGlow: z.number().min(0).max(2).default(0.9).meta({ label: 'lamp glow', step: 0.05 }),
  evening: z.number().min(0).max(1).default(0.35).meta({ label: 'warm evening light', step: 0.01 }),
})
type Config = z.infer<typeof Config>

type Three = PluginApi['render']['three']
type Obj = InstanceType<Three['Object3D']>

export default definePlugin({
  id: 'rooms',
  version: '0.1.0',
  description: 'Интерьеры: стены, полы, окна, двери, свет и пыль в лучах — общий вид всех помещений',
  optionalDependsOn: ['weather'],

  setup(api) {
    const cfg = api.config.define(Config)
    const T = api.render.three
    const tex = canvasTextures(T)
    api.onDispose(() => Object.values(tex).forEach((t) => t.dispose()))
    const live = new Set<Live>()
    const skyColor = new T.Color()
    const lightColor = new T.Color()
    const tmpA = new T.Color()
    const tmpB = new T.Color()
    const warm = new T.Color()
    let rain = 0
    let night = 0

    const kit: RoomsKit = { build: (spec) => buildShell(api, cfg, T, tex, spec, live) }
    api.services.provide('rooms:kit', kit)

    // warm evenings inside, when a room's lights are on
    api.hooks.tap(
      'light:adjust',
      (st) => {
        if (!api.interiors.current) return st
        for (const l of live) {
          if (!l.lights) continue
          warm.set(cfg.lamp)
          st.sky.lerp(warm, cfg.evening * night)
          st.ground.lerp(warm, cfg.evening * night * 0.6)
        }
        return st
      },
      { priority: 1050 },
    )

    let time = 0
    api.systems.add({
      id: 'interiors',
      phase: 'render',
      run: ({ dt }) => {
        if (!live.size) return
        time += dt
        // the hour outside: sky color, how much light comes in, night
        const keys = cfg.sky
        if (keys.length) {
          const { i, j, k } = dayBlend(keys, api.time.hour)
          const a = keys[i]!
          const b = keys[j]!
          skyColor.copy(tmpA.set(a.color)).lerp(tmpB.set(b.color), k)
          const amount = a.light + (b.light - a.light) * k
          night = Math.max(0, Math.min(1, (0.45 - amount) / 0.3))
          lightColor.set(cfg.sunlight).lerp(tmpA.set(cfg.moonlight), night).multiplyScalar(amount)
        }
        const w = api.services.has('weather:forecast') ? api.services.get('weather:forecast').current() : undefined
        const wet = w && w.precipitation === 'rain' ? Math.min(1, 0.5 + w.intensity * 0.5) : 0
        rain += (wet - rain) * Math.min(1, dt * 0.8)
        const grey = w ? 1 - Math.min(0.6, (1 - w.light.sun) * 0.7) : 1
        tex.rain.offset.y = (tex.rain.offset.y + dt * 0.35) % 1
        const yaw = api.render.camera.targetYaw
        for (const l of live) l.update(time, yaw, skyColor, lightColor, grey, night, rain, cfg)
      },
    })
  },
})

// --- one room's shell ----------------------------------------------------------------------------

interface Textures {
  sky: InstanceType<Three['CanvasTexture']>
  stars: InstanceType<Three['CanvasTexture']>
  rain: InstanceType<Three['CanvasTexture']>
  pool: InstanceType<Three['CanvasTexture']>
  beam: InstanceType<Three['CanvasTexture']>
  glow: InstanceType<Three['CanvasTexture']>
  mote: InstanceType<Three['CanvasTexture']>
}

interface Live {
  lights: boolean
  update(
    time: number,
    yaw: number,
    sky: InstanceType<Three['Color']>,
    light: InstanceType<Three['Color']>,
    grey: number,
    night: number,
    rain: number,
    cfg: Config,
  ): void
}

function buildShell(api: PluginApi, cfg: Config, T: Three, tex: Textures, spec: ShellSpec, live: Set<Live>): Shell {
  const root = api.render.add(new T.Group())
  root.name = 'room-shell'
  const { box, floorY: Y, height: H, look } = spec
  const runs = planWalls(box, spec.doors, spec.windows, cfg.thick)
  const disposables: Array<{ dispose(): void }> = []
  const surfaceMaterial = (s: Surface, opts: { side?: number; vertexColors?: boolean } = {}) => {
    const m = api.render.stylize(
      new T.MeshLambertMaterial({
        map: api.render.material(s.material, cfg.textureSize),
        color: s.color,
        vertexColors: opts.vertexColors ?? false,
        side: (opts.side ?? T.FrontSide) as never,
      }),
    )
    disposables.push(m)
    return m
  }
  const toMesh = (b: MeshBuilder, mat: InstanceType<Three['Material']>, parent: Obj, opts: { receive?: boolean; order?: number } = {}) => {
    if (b.empty) return null
    const g = new T.BufferGeometry()
    g.setAttribute('position', new T.Float32BufferAttribute(b.pos, 3))
    g.setAttribute('normal', new T.Float32BufferAttribute(b.nor, 3))
    g.setAttribute('uv', new T.Float32BufferAttribute(b.uv, 2))
    g.setAttribute('color', new T.Float32BufferAttribute(b.col, 3))
    g.setIndex(b.idx)
    g.computeBoundingSphere()
    disposables.push(g)
    const m = new T.Mesh(g, mat)
    m.receiveShadow = opts.receive ?? true
    if (opts.order !== undefined) m.renderOrder = opts.order
    parent.add(m)
    return m
  }
  const tiles = cfg.tiles
  const wallMat = surfaceMaterial(look.wall)
  const trimMat = surfaceMaterial(look.trim)
  const wainMat = look.wainscot ? surfaceMaterial(look.wainscot) : null
  const doorMat = surfaceMaterial(look.door)
  const matMat = surfaceMaterial(look.mat)
  const curtainMat = look.curtain ? surfaceMaterial(look.curtain, { side: T.DoubleSide, vertexColors: true }) : null

  // --- floor: cell by cell, grouped by surface, darker along the walls ---------------------------
  const floors = new Map<string, { s: Surface; b: MeshBuilder }>()
  for (let z = box.z0 + 1; z < box.z0 + box.d - 1; z++)
    for (let x = box.x0 + 1; x < box.x0 + box.w - 1; x++) {
      const s = spec.floorAt?.(x, z) ?? look.floor
      const key = `${s.material}|${s.color}`
      let f = floors.get(key)
      if (!f) floors.set(key, (f = { s, b: new MeshBuilder(cfg.floorTiles) }))
      const sh = (px: number, pz: number) => 1 - cfg.floorShade * floorShade(box, px, pz, cfg.floorShadeReach)
      f.b.quad(
        [
          [x, Y, z + 1],
          [x + 1, Y, z + 1],
          [x + 1, Y, z],
          [x, Y, z],
        ],
        [0, 1, 0],
        [sh(x, z + 1), sh(x + 1, z + 1), sh(x + 1, z), sh(x, z)],
      )
    }
  for (const { s, b } of floors.values()) toMesh(b, surfaceMaterial(s, { vertexColors: true }), root)
  // built-ins: a moulded base, an inset body, an overhanging top; sides between neighbours are left out
  for (const bi of spec.builtIns ?? []) {
    const body = new MeshBuilder(tiles)
    const top = new MeshBuilder(tiles)
    const at = new Set(bi.cells.map((c) => `${c.x},${c.z}`))
    const has = (x: number, z: number) => at.has(`${x},${z}`)
    const h = bi.height
    for (const c of bi.cells) {
      const open = { nx: !has(c.x - 1, c.z), px: !has(c.x + 1, c.z), nz: !has(c.x, c.z - 1), pz: !has(c.x, c.z + 1) }
      const skip = (Object.keys(open) as Array<keyof typeof open>).filter((k) => !open[k])
      // inset on open sides only, so a row of cells reads as one long plinth
      const ins = (side: keyof typeof open, d: number) => (open[side] ? d : 0)
      const x0 = c.x + ins('nx', 0.06)
      const x1 = c.x + 1 - ins('px', 0.06)
      const z0 = c.z + ins('nz', 0.06)
      const z1 = c.z + 1 - ins('pz', 0.06)
      body.box([x0, Y, z0], [x1, Y + h - 0.08, z1], [...skip, 'bottom', 'top'])
      // base moulding and top slab stand out a little past the body
      const bx0 = c.x + ins('nx', 0.02)
      const bx1 = c.x + 1 - ins('px', 0.02)
      const bz0 = c.z + ins('nz', 0.02)
      const bz1 = c.z + 1 - ins('pz', 0.02)
      top.box([bx0, Y, bz0], [bx1, Y + 0.12, bz1], [...skip, 'bottom'])
      top.box(
        [c.x - (open.nx ? 0.01 : 0), Y + h - 0.08, c.z - (open.nz ? 0.01 : 0)],
        [c.x + 1 + (open.px ? 0.01 : 0), Y + h, c.z + 1 + (open.pz ? 0.01 : 0)],
        skip,
      )
    }
    toMesh(body, surfaceMaterial(bi.body), root)
    toMesh(top, surfaceMaterial(bi.top), root)
  }

  // the floor slab under the room, seen in cross-section past the low walls
  const slab = new MeshBuilder(tiles)
  slab.box([box.x0 + 1 - cfg.thick, Y - 0.45, box.z0 + 1 - cfg.thick], [box.x0 + box.w - 1 + cfg.thick, Y - 0.002, box.z0 + box.d - 1 + cfg.thick], ['top'])
  toMesh(slab, trimMat, root)

  // --- walls ---------------------------------------------------------------------------------------
  interface RunView {
    run: WallRun
    full: Obj
    low: Obj
  }
  const views: RunView[] = []
  // positions across a wall: from its inner face `d` units out (negative: into the room)
  const across = (run: WallRun, d0: number, d1: number): [number, number] => {
    const a = run.plane + (run.out[0] + run.out[1]) * d0
    const b = run.plane + (run.out[0] + run.out[1]) * d1
    return a < b ? [a, b] : [b, a]
  }
  const alongX = (run: WallRun) => run.side === 'north' || run.side === 'south'
  const boxOn = (
    b: MeshBuilder,
    run: WallRun,
    a: number,
    bb: number,
    y0: number,
    y1: number,
    d0: number,
    d1: number,
    skip: Parameters<MeshBuilder['box']>[2] = [],
  ) => {
    const [p0, p1] = across(run, d0, d1)
    if (alongX(run)) b.box([a, Y + y0, p0], [bb, Y + y1, p1], skip)
    else b.box([p0, Y + y0, a], [p1, Y + y1, bb], skip)
  }
  const sconces: Array<{ x: number; y: number; z: number; run: WallRun }> = []
  const windows: Array<{ run: WallRun; a: number; b: number }> = []
  for (const run of runs) {
    const full = new T.Group()
    const low = new T.Group()
    root.add(full, low)
    views.push({ run, full, low })
    for (const [group, height, cutaway] of [
      [full, H, false],
      [low, cfg.lowHeight, true],
    ] as const) {
      const paper = new MeshBuilder(tiles)
      const wood = new MeshBuilder(tiles)
      const trim = new MeshBuilder(tiles)
      const wainH = look.wainscot ? Math.min(height, look.wainscot.height) : 0
      const pieces = wallPieces(
        run,
        height,
        { top: Math.min(height, cfg.doorTop) },
        cutaway ? { sill: height, top: height } : { sill: cfg.sill, top: cfg.windowTop },
      )
      for (const p of pieces) {
        // wainscot below, paper above; the wall's top gets a cap of trim
        if (wainH > p.y0) boxOn(wood, run, p.a, p.b, p.y0, Math.min(p.y1, wainH), 0, cfg.thick, ['top', 'bottom'])
        if (p.y1 > Math.max(p.y0, wainH)) boxOn(paper, run, p.a, p.b, Math.max(p.y0, wainH), p.y1, 0, cfg.thick, ['top', 'bottom'])
        if (p.y1 >= height - 1e-6) boxOn(trim, run, p.a, p.b, p.y1, p.y1 + 0.04, -0.02, cfg.thick + 0.02)
      }
      // trims along the wall, broken by the door
      const spans: Array<[number, number]> = []
      let at = run.from
      for (const o of run.openings) {
        if (o.kind !== 'door') continue
        if (o.a > at) spans.push([at, o.a])
        at = o.b
      }
      if (run.to > at) spans.push([at, run.to])
      for (const [a, b] of spans) {
        if (cfg.baseboard > 0) boxOn(trim, run, a, b, 0, Math.min(height, cfg.baseboard), -cfg.trimDepth, 0.001, ['bottom'])
        if (look.wainscot && wainH < height) boxOn(trim, run, a, b, wainH - 0.03, wainH + 0.04, -cfg.trimDepth * 0.8, 0.001)
        if (!cutaway && cfg.cornice > 0) boxOn(trim, run, a, b, height - cfg.cornice, height, -cfg.trimDepth * 1.4, 0.001, ['top'])
      }
      for (const o of run.openings) {
        const top = o.kind === 'door' ? Math.min(height, cfg.doorTop) : cutaway ? height : cfg.windowTop
        const f = cfg.frame
        // reveals: the inside of the opening, through the wall
        if (o.kind === 'window' && !cutaway) {
          windows.push({ run, a: o.a, b: o.b })
          boxOn(trim, run, o.a - f, o.b + f, cfg.sill - 0.06, cfg.sill, -0.14, cfg.thick * 0.5) // sill
          boxOn(trim, run, o.a - f, o.a, cfg.sill, top + f, -cfg.trimDepth, 0.001) // frame
          boxOn(trim, run, o.b, o.b + f, cfg.sill, top + f, -cfg.trimDepth, 0.001)
          boxOn(trim, run, o.a - f, o.b + f, top, top + f, -cfg.trimDepth, 0.001)
          const mid = (o.a + o.b) / 2
          boxOn(trim, run, mid - 0.025, mid + 0.025, cfg.sill, top, cfg.thick * 0.45, cfg.thick * 0.55) // mullion
          boxOn(trim, run, o.a, o.b, (cfg.sill + top) / 2 - 0.025, (cfg.sill + top) / 2 + 0.025, cfg.thick * 0.45, cfg.thick * 0.55)
          for (const end of [o.a, o.b]) boxOn(paper, run, end - 0.001, end + 0.001, cfg.sill, top, 0, cfg.thick)
          boxOn(paper, run, o.a, o.b, top - 0.001, top, 0, cfg.thick)
          // a lamp on each side of a run of windows
          const ax = alongX(run)
          const [p] = across(run, -0.12, -0.12)
          for (const at of [o.a - 0.55, o.b + 0.55]) {
            if (at < run.from + 0.6 || at > run.to - 0.6) continue
            if (sconces.some((s) => s.run === run && Math.abs((ax ? s.x : s.z) - at) < 1.2)) continue
            sconces.push({ x: ax ? at : p, y: Y + 1.85, z: ax ? p : at, run })
          }
        }
        if (o.kind === 'door') {
          boxOn(trim, run, o.a - f, o.a, 0, top + (cutaway ? 0 : f), -cfg.trimDepth, cfg.thick + 0.02) // jambs
          boxOn(trim, run, o.b, o.b + f, 0, top + (cutaway ? 0 : f), -cfg.trimDepth, cfg.thick + 0.02)
          if (!cutaway) {
            boxOn(trim, run, o.a - f, o.b + f, top, top + f, -cfg.trimDepth, cfg.thick + 0.02)
            // the door itself, closed, set into the wall, with panels and a knob
            const door = new MeshBuilder(tiles)
            boxOn(door, run, o.a + 0.01, o.b - 0.01, 0.01, top - 0.01, cfg.thick * 0.55, cfg.thick * 0.75)
            const w = o.b - o.a
            for (const [y0, y1] of [
              [0.25, top * 0.45],
              [top * 0.52, top - 0.22],
            ] as const)
              for (let k = 0; k < Math.max(1, Math.round(w)); k++) {
                const a = o.a + k * (w / Math.max(1, Math.round(w)))
                boxOn(door, run, a + 0.16, a + w / Math.max(1, Math.round(w)) - 0.16, y0, y1, cfg.thick * 0.5, cfg.thick * 0.55)
              }
            toMesh(door, doorMat, group)
            const knob = new MeshBuilder(tiles)
            const kx = o.b - 0.2
            boxOn(knob, run, kx - 0.05, kx + 0.05, 1.0, 1.1, cfg.thick * 0.42, cfg.thick * 0.55)
            toMesh(knob, trimMat, group)
          }
          boxOn(trim, run, o.a, o.b, 0, 0.03, -0.02, cfg.thick) // threshold
          if (!cutaway) {
            // a mat in front of the door, inside
            const mat = new MeshBuilder(tiles)
            boxOn(mat, run, o.a + 0.08, o.b - 0.08, 0, 0.035, -0.95, -0.08)
            toMesh(mat, matMat, root)
          }
        }
      }
      toMesh(paper, wallMat, group)
      if (wainMat) toMesh(wood, wainMat, group)
      toMesh(trim, trimMat, group)
    }
  }

  // --- windows: the sky behind, rain on the glass, light falling in, dust in the light ------------
  const skyMat = new T.MeshBasicMaterial({ map: tex.sky, color: '#ffffff', fog: false })
  const starMat = new T.MeshBasicMaterial({
    map: tex.stars,
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    opacity: 0,
  })
  const rainMat = new T.MeshBasicMaterial({ map: tex.rain, transparent: true, depthWrite: false, opacity: 0 })
  const poolMat = new T.MeshBasicMaterial({
    map: tex.pool,
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    opacity: 0,
    color: '#ffffff',
  })
  const beamMat = new T.MeshBasicMaterial({
    map: tex.beam,
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    opacity: 0,
    color: '#ffffff',
    side: T.DoubleSide,
  })
  for (const m of [skyMat, starMat, rainMat, poolMat, beamMat]) disposables.push(api.render.stylize(m))
  const windowViews: Array<{ run: WallRun; glass: Obj[]; light: Obj[] }> = []
  // one curtain panel, a block wide (scaled to how far it is drawn), hanging from the rod
  const curtains: Array<{ obj: Obj; sign: number; open: number; closed: number }> = []
  let clothGeo: InstanceType<Three['Mesh']>['geometry'] | null = null
  if (curtainMat) {
    const c = new MeshBuilder(tiles)
    c.cloth(true, 0, 1, 0, Y + cfg.windowTop + 0.2, Y + Math.max(0.15, cfg.sill - 0.3), 3, 0.04, 1)
    const g = new T.BufferGeometry()
    g.setAttribute('position', new T.Float32BufferAttribute(c.pos, 3))
    g.setAttribute('normal', new T.Float32BufferAttribute(c.nor, 3))
    g.setAttribute('uv', new T.Float32BufferAttribute(c.uv, 2))
    g.setAttribute('color', new T.Float32BufferAttribute(c.col, 3))
    g.setIndex(c.idx)
    g.computeBoundingSphere()
    disposables.push(g)
    clothGeo = g
  }
  const motes: number[] = []
  const moteHome: number[] = []
  for (const wnd of windows) {
    const { run } = wnd
    const ax = alongX(run)
    const mid = (wnd.a + wnd.b) / 2
    const width = wnd.b - wnd.a
    const h = cfg.windowTop - cfg.sill
    const [gp] = across(run, cfg.thick * 0.6, cfg.thick * 0.6)
    const inward: [number, number] = [-run.out[0], -run.out[1]]
    const plane = (geo: InstanceType<Three['PlaneGeometry']>, mat: InstanceType<Three['Material']>, order: number) => {
      disposables.push(geo)
      const m = new T.Mesh(geo, mat)
      m.position.set(ax ? mid : gp, Y + cfg.sill + h / 2, ax ? gp : mid)
      // face into the room
      m.rotation.y = Math.atan2(inward[0], inward[1])
      m.renderOrder = order
      return m
    }
    const glass = [
      plane(new T.PlaneGeometry(width, h), skyMat, 0),
      plane(new T.PlaneGeometry(width, h), starMat, 1),
      plane(new T.PlaneGeometry(width, h), rainMat, 2),
    ]
    glass[1]!.position.addScaledVector(new T.Vector3(inward[0], 0, inward[1]), 0.002)
    glass[2]!.position.addScaledVector(new T.Vector3(inward[0], 0, inward[1]), 0.004)
    // the pool of light on the floor and the slanted beam that falls to it
    const depth = 2.3
    const poolGeo = new T.PlaneGeometry(width + 0.5, depth).rotateX(-Math.PI / 2)
    disposables.push(poolGeo)
    const pool = new T.Mesh(poolGeo, poolMat)
    pool.position.set((ax ? mid : run.plane) + inward[0] * (depth / 2 + 0.25), Y + 0.006, (ax ? run.plane : mid) + inward[1] * (depth / 2 + 0.25))
    pool.rotation.y = Math.atan2(inward[0], inward[1])
    pool.renderOrder = 3
    const beamGeo = new T.PlaneGeometry(width + 0.2, Math.hypot(depth, cfg.sill + h * 0.5))
    disposables.push(beamGeo)
    const beam = new T.Mesh(beamGeo, beamMat)
    beam.position.set((ax ? mid : run.plane) + inward[0] * (depth * 0.55), Y + (cfg.sill + h * 0.5) / 2, (ax ? run.plane : mid) + inward[1] * (depth * 0.55))
    beam.rotation.order = 'YXZ'
    beam.rotation.y = Math.atan2(inward[0], inward[1])
    beam.rotation.x = -Math.atan2(depth, cfg.sill + h * 0.5) + Math.PI / 2
    beam.renderOrder = 4
    const holder = new T.Group()
    holder.add(...glass)
    if (curtainMat && clothGeo) {
      // two curtains on a rod above the window, gathered at the sides; drawn, they meet in the middle
      const rod = new MeshBuilder(tiles)
      const top = Y + cfg.windowTop + 0.2
      const [r0, r1] = across(run, -0.15, -0.09)
      if (ax) rod.box([wnd.a - 0.55, top, r0], [wnd.b + 0.55, top + 0.05, r1])
      else rod.box([r0, top, wnd.a - 0.55], [r1, top + 0.05, wnd.b + 0.55])
      toMesh(rod, trimMat, holder)
      const [cp] = across(run, -0.12, -0.12)
      // local +x of a panel runs along the wall, +z into the room
      const turn = Math.atan2(inward[0], inward[1])
      const localX: [number, number] = [Math.cos(turn), -Math.sin(turn)]
      const alongSign = ax ? localX[0] : localX[1]
      for (const [anchor, dir] of [
        [wnd.a - 0.42, 1],
        [wnd.b + 0.42, -1],
      ] as const) {
        const g = new T.Group()
        g.position.set(ax ? anchor : cp, 0, ax ? cp : anchor)
        g.rotation.y = turn
        const m = new T.Mesh(clothGeo, curtainMat)
        g.add(m)
        holder.add(g)
        curtains.push({ obj: g, sign: dir * alongSign, open: 0.5, closed: width / 2 + 0.47 })
      }
    }
    const lightHolder = new T.Group()
    lightHolder.add(pool, beam)
    root.add(holder, lightHolder)
    windowViews.push({ run, glass: [holder], light: [lightHolder] })
    // dust: somewhere in the beam
    for (let i = 0; i < cfg.motes; i++) {
      const t = Math.random()
      const side = (Math.random() - 0.5) * width
      const yy = Y + 0.2 + (1 - t) * (cfg.sill + h * 0.6) + (Math.random() - 0.5) * 0.4
      const x = (ax ? mid + side : run.plane) + inward[0] * (0.2 + t * depth)
      const z = (ax ? run.plane : mid + side) + inward[1] * (0.2 + t * depth)
      moteHome.push(x, yy, z, Math.random() * Math.PI * 2)
      motes.push(x, yy, z)
    }
  }
  let dust: InstanceType<Three['Points']> | null = null
  const motePos = new Float32Array(motes)
  if (motes.length) {
    const geo = new T.BufferGeometry()
    geo.setAttribute('position', new T.BufferAttribute(motePos, 3))
    const mat = api.render.stylize(
      new T.PointsMaterial({
        map: tex.mote,
        size: 0.07,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
        opacity: 0,
        color: '#fff6dc',
      }),
    )
    disposables.push(geo, mat)
    dust = new T.Points(geo, mat)
    dust.renderOrder = 5
    dust.frustumCulled = false
    root.add(dust)
  }

  // --- lamps on the walls ---------------------------------------------------------------------------
  const lampMat = api.render.stylize(new T.MeshLambertMaterial({ color: '#fff4dc', emissive: '#ffcf8a', emissiveIntensity: 0 }))
  const glowMat = new T.SpriteMaterial({
    map: tex.glow,
    color: '#ffc978',
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    opacity: 0,
  })
  disposables.push(lampMat, glowMat)
  const lamps: Array<{ run: WallRun; obj: Obj }> = []
  for (const s of sconces) {
    const g = new T.Group()
    const b = new MeshBuilder(tiles)
    const ax = alongX(s.run)
    const [p0, p1] = across(s.run, -0.02, 0.001)
    const along = ax ? s.x : s.z
    // a little brass plate and a cream shade
    if (ax) b.box([along - 0.07, s.y - 0.12, p0], [along + 0.07, s.y + 0.08, p1])
    else b.box([p0, s.y - 0.12, along - 0.07], [p1, s.y + 0.08, along + 0.07])
    toMesh(b, trimMat, g)
    const shadeGeo = new T.CylinderGeometry(0.09, 0.14, 0.2, 10)
    disposables.push(shadeGeo)
    const shade = new T.Mesh(shadeGeo, lampMat)
    const inward = [-s.run.out[0], -s.run.out[1]]
    shade.position.set(s.x + inward[0]! * 0.14, s.y + 0.1, s.z + inward[1]! * 0.14)
    const glow = new T.Sprite(glowMat)
    glow.scale.setScalar(1.6)
    glow.position.copy(shade.position)
    glow.position.y += 0.05
    g.add(shade, glow)
    root.add(g)
    lamps.push({ run: s.run, obj: g })
  }

  // --- every frame -----------------------------------------------------------------------------------
  let lastYaw = NaN
  let drawn = 0
  let drawTo = 0
  let lastTime = 0
  const state: Live = {
    lights: true,
    update(time, yaw, sky, light, grey, night, rain, c) {
      // curtains glide (ease out) to where they were asked to be
      const dt = Math.min(0.1, Math.max(0, time - lastTime))
      lastTime = time
      if (Math.abs(drawTo - drawn) > 1e-4) drawn += (drawTo - drawn) * Math.min(1, dt * 3.2)
      for (const cu of curtains) cu.obj.scale.x = cu.sign * (cu.open + (cu.closed - cu.open) * drawn)
      const shut = 1 - 0.85 * drawn
      if (yaw !== lastYaw) {
        lastYaw = yaw
        for (const v of views) {
          const near = facesCamera(v.run, yaw)
          v.full.visible = !near
          v.low.visible = near
        }
        for (const w of windowViews) {
          const near = facesCamera(w.run, yaw)
          for (const o of w.glass) o.visible = !near
        }
        for (const l of lamps) l.obj.visible = !facesCamera(l.run, yaw)
      }
      skyMat.color.copy(sky).multiplyScalar(grey)
      starMat.opacity = night * (1 - rain)
      rainMat.opacity = rain * 0.85
      const strength = (light.r + light.g + light.b) / 3
      poolMat.color.copy(light)
      poolMat.opacity = c.lightPool * Math.min(1, strength * 1.4) * (1 - rain * 0.6) * grey * shut
      beamMat.color.copy(light)
      beamMat.opacity = c.beam * Math.min(1, strength * 1.4) * (1 - rain * 0.7) * grey * shut
      for (const w of windowViews) for (const o of w.light) o.visible = poolMat.opacity > 0.005
      // lamps: on in the evening and at night (if the room's lights are)
      const glow = this.lights ? Math.max(night, 1 - Math.min(1, strength * 1.6)) * c.lampGlow : 0
      glowMat.opacity = Math.min(1, glow) * (0.85 + 0.15 * Math.sin(time * 2.1))
      glowMat.color.set(c.lamp)
      lampMat.emissiveIntensity = glow
      if (dust) {
        const m = dust.material as InstanceType<Three['PointsMaterial']>
        m.opacity = Math.min(1, beamMat.opacity * 4.5)
        if (m.opacity > 0.01) {
          for (let i = 0, o = 0; o < motePos.length; i++, o += 3) {
            const ph = moteHome[i * 4 + 3]!
            motePos[o] = moteHome[i * 4]! + Math.sin(time * 0.21 + ph) * 0.18
            motePos[o + 1] = moteHome[i * 4 + 1]! + Math.sin(time * 0.13 + ph * 1.7) * 0.25
            motePos[o + 2] = moteHome[i * 4 + 2]! + Math.cos(time * 0.17 + ph) * 0.18
          }
          dust.geometry.getAttribute('position').needsUpdate = true
        }
      }
    },
  }
  live.add(state)
  return {
    setLights(on) {
      state.lights = on
    },
    setCurtains(closed) {
      drawTo = closed ? 1 : 0
    },
    dispose() {
      live.delete(state)
      root.removeFromParent()
      for (const d of disposables) d.dispose()
    },
  }
}

// --- small pictures painted once ---------------------------------------------------------------------

function canvasTextures(T: Three): Textures {
  const make = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    draw(c.getContext('2d')!)
    const t = new T.CanvasTexture(c)
    if (srgb) t.colorSpace = T.SRGBColorSpace
    return t
  }
  // the sky through a window: lighter towards the horizon, a few soft clouds, a pale sheen on the glass
  const sky = make(128, 128, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 128)
    grad.addColorStop(0, '#d8d8d8')
    grad.addColorStop(1, '#ffffff')
    g.fillStyle = grad
    g.fillRect(0, 0, 128, 128)
    g.fillStyle = 'rgba(255,255,255,0.85)'
    for (const [x, y, r] of [
      [30, 70, 14],
      [44, 64, 18],
      [60, 72, 12],
      [96, 40, 10],
      [108, 36, 13],
    ] as const) {
      g.beginPath()
      g.arc(x, y, r, 0, Math.PI * 2)
      g.fill()
    }
    g.fillStyle = 'rgba(255,255,255,0.35)'
    g.beginPath()
    g.moveTo(10, 128)
    g.lineTo(48, 0)
    g.lineTo(66, 0)
    g.lineTo(28, 128)
    g.fill()
  })
  const stars = make(128, 128, (g) => {
    g.fillStyle = '#000'
    g.fillRect(0, 0, 128, 128)
    let s = 7
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
    for (let i = 0; i < 40; i++) {
      const x = rnd() * 128
      const y = rnd() * 110
      const r = 0.6 + rnd() * 1.2
      g.fillStyle = `rgba(255,248,220,${0.5 + rnd() * 0.5})`
      g.beginPath()
      g.arc(x, y, r, 0, Math.PI * 2)
      g.fill()
    }
    g.fillStyle = 'rgba(255,250,230,0.95)'
    g.beginPath()
    g.arc(94, 30, 9, 0, Math.PI * 2) // the moon
    g.fill()
  })
  const rainTex = make(64, 128, (g) => {
    g.clearRect(0, 0, 64, 128)
    let s = 3
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
    for (let i = 0; i < 26; i++) {
      const x = rnd() * 64
      const y = rnd() * 128
      const len = 6 + rnd() * 18
      g.strokeStyle = `rgba(230,240,255,${0.35 + rnd() * 0.4})`
      g.lineWidth = 1 + rnd()
      g.beginPath()
      g.moveTo(x, y)
      g.lineTo(x + rnd() * 2 - 1, y + len)
      g.stroke()
      g.fillStyle = 'rgba(240,248,255,0.7)'
      g.beginPath()
      g.arc(x, y + len, 1.4, 0, Math.PI * 2)
      g.fill()
    }
  })
  rainTex.wrapS = rainTex.wrapT = T.RepeatWrapping
  const soft = (w: number, h: number, inner: number) =>
    make(
      w,
      h,
      (g) => {
        const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) / 2)
        grad.addColorStop(0, 'rgba(255,255,255,1)')
        grad.addColorStop(inner, 'rgba(255,255,255,0.55)')
        grad.addColorStop(1, 'rgba(255,255,255,0)')
        g.fillStyle = grad
        g.fillRect(0, 0, w, h)
      },
      false,
    )
  // the pool of window light: a soft rectangle, brightest near the window (texture top)
  const pool = make(
    64,
    128,
    (g) => {
      const grad = g.createLinearGradient(0, 0, 0, 128)
      grad.addColorStop(0, 'rgba(255,255,255,0.9)')
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = grad
      g.fillRect(0, 0, 64, 128)
      g.globalCompositeOperation = 'destination-in'
      const side = g.createLinearGradient(0, 0, 64, 0)
      side.addColorStop(0, 'rgba(0,0,0,0)')
      side.addColorStop(0.2, 'rgba(0,0,0,1)')
      side.addColorStop(0.8, 'rgba(0,0,0,1)')
      side.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = side
      g.fillRect(0, 0, 64, 128)
    },
    false,
  )
  const beam = make(
    64,
    128,
    (g) => {
      const grad = g.createLinearGradient(0, 0, 0, 128)
      grad.addColorStop(0, 'rgba(255,255,255,0.8)')
      grad.addColorStop(1, 'rgba(255,255,255,0.05)')
      g.fillStyle = grad
      g.fillRect(0, 0, 64, 128)
      g.globalCompositeOperation = 'destination-in'
      const side = g.createLinearGradient(0, 0, 64, 0)
      side.addColorStop(0, 'rgba(0,0,0,0)')
      side.addColorStop(0.3, 'rgba(0,0,0,1)')
      side.addColorStop(0.7, 'rgba(0,0,0,1)')
      side.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = side
      g.fillRect(0, 0, 64, 128)
    },
    false,
  )
  return { sky, stars, rain: rainTex, pool, beam, glow: soft(64, 64, 0.25), mote: soft(16, 16, 0.4) }
}
