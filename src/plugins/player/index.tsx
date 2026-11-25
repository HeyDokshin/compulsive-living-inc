/**
 * The player: camera-relative movement (keyboard or gamepad), voxel collision with auto-step,
 * no walking off cliffs or into water, smooth turning, camera follow, a soft cursor on the
 * cell in front of the player, and the "use" button that runs the interaction matrix there.
 */
import { definePlugin, findPath, signal, ui, z, type Cell, type Entity, type PluginApi } from '@sdk'
import { moveBody, type Body, type MoveRules, type WorldQuery } from './physics'

declare module '@sdk' {
  interface Components {
    player?: { vx: number; vz: number; vy: number; grounded: boolean }
  }
  interface GameEvents {
    /** The cell in front of the player changed. */
    'player:target': { x: number; y: number; z: number; block: string }
    /** A click-to-walk reached the clicked cell (and should act on it). */
    'player:arrived': { x: number; z: number }
  }
}

/** Click-to-walk in progress. */
interface Walk {
  path: Cell[]
  /** Cell to face (and act on) when the path ends. */
  target?: Cell
  act: boolean
  stuckFor: number
}

/** State shared by setup() and start() of one plugin instance. */
const shared = new WeakMap<object, { walk: Walk | null }>()
const stateOf = (api: PluginApi) => {
  let st = shared.get(api)
  if (!st) shared.set(api, (st = { walk: null }))
  return st
}

const Config = z.object({
  walkSpeed: z.number().min(0.5).max(12).default(3.1).meta({ label: 'walk speed', step: 0.1 }),
  runSpeed: z.number().min(0.5).max(20).default(5.6).meta({ label: 'run speed', step: 0.1 }),
  /** How quickly the character reaches walking speed (gentle start). */
  acceleration: z.number().min(1).max(60).default(10).meta({ step: 0.5 }),
  /** How quickly the character stops when you let go (no sliding). */
  deceleration: z.number().min(1).max(80).default(22).meta({ step: 0.5 }),
  turnSpeed: z.number().min(1).max(40).default(14).meta({ label: 'turn speed', step: 0.5 }),
  radius: z.number().min(0.1).max(0.49).default(0.3).meta({ step: 0.01 }),
  height: z.number().min(0.5).max(3).default(1.3).meta({ step: 0.05 }),
  step: z.number().int().min(0).max(3).default(1).meta({ label: 'step height', step: 1 }),
  maxDrop: z.number().int().min(0).max(32).default(1).meta({ label: 'max drop', step: 1 }),
  gravity: z.number().min(1).max(80).default(32).meta({ step: 1 }),
  waterBlocks: z.boolean().default(true).meta({ label: 'water blocks walking' }),
  /** Footstep spacing in blocks (walking / running). */
  stride: z.number().min(0.3).max(3).default(0.9).meta({ step: 0.05 }),
  runStride: z.number().min(0.3).max(3).default(1.15).meta({ label: 'run stride', step: 0.05 }),
  /** Seconds the mouse cursor keeps showing the hovered cell after it stops moving. */
  hoverTimeout: z.number().min(0).max(30).default(4).meta({ label: 'hover timeout (s)', step: 0.5 }),
  cursor: z.boolean().default(true),
  cursorColor: z.string().default('#ffffff').meta({ color: true }),
  hint: z.boolean().default(true),
})
type Config = z.infer<typeof Config>

export default definePlugin({
  id: 'player',
  version: '0.1.0',
  description: 'Игрок: движение, столкновения, камера, курсор клетки',
  dependsOn: ['characters'],

  setup(api) {
    const cfg = api.config.define(Config)
    api.components.define(
      'player',
      z.object({ vx: z.number().default(0), vz: z.number().default(0), vy: z.number().default(0), grounded: z.boolean().default(false) }),
    )

    const keys = {
      up: api.input.action('up', ['KeyW', 'ArrowUp', 'Pad12']),
      down: api.input.action('down', ['KeyS', 'ArrowDown', 'Pad13']),
      left: api.input.action('left', ['KeyA', 'ArrowLeft', 'Pad14']),
      right: api.input.action('right', ['KeyD', 'ArrowRight', 'Pad15']),
      run: api.input.action('run', ['ShiftLeft', 'ShiftRight', 'Pad1']),
    }

    const blocks = api.registry('blocks')
    const liquidCache = new Map<string, boolean>()
    api.registry('blocks').onChange(() => liquidCache.clear())
    const query: WorldQuery = {
      solid: (x, y, z) => api.world.isSolid(x, y, z) || api.hooks.run('movement:blocked', false, { x, y, z }),
      liquid: (x, y, z) => {
        const id = api.world.getBlock(x, y, z)
        let v = liquidCache.get(id)
        if (v === undefined) liquidCache.set(id, (v = blocks.isTagged(id, '#core:liquid')))
        return v
      },
    }
    const rules = (): MoveRules => ({ step: cfg.step, maxDrop: cfg.maxDrop, gravity: cfg.gravity, waterBlocks: cfg.waterBlocks })

    const dir = new api.render.three.Vector3()
    let stepDist = 0
    api.systems.add({
      id: 'move',
      phase: 'update',
      run: ({ dt }) => {
        for (const e of api.entities.world.with('player', 'transform')) {
          const p = e.player
          const t = e.transform
          // Input: keys + left stick, relative to the camera (up = away from the camera).
          // No walking while a window is open or during a tool swing / pickup.
          const locked = api.ui.modalOpen.value || !!e.biped?.action
          let r = locked ? 0 : Number(api.input.isDown(keys.right)) - Number(api.input.isDown(keys.left)) + api.input.stick.x
          let u = locked ? 0 : Number(api.input.isDown(keys.up)) - Number(api.input.isDown(keys.down)) - api.input.stick.y
          const mag = Math.hypot(r, u)
          if (mag > 1) (r /= mag), (u /= mag)
          let speed = api.input.isDown(keys.run) ? cfg.runSpeed : cfg.walkSpeed
          let tx = 0
          let tz = 0
          const st = stateOf(api)
          if (mag > 0.01) {
            st.walk = null // keys/stick take over from click-to-walk
            api.render.camera.screenToWorldDir(r, u, dir)
            const len = Math.hypot(dir.x, dir.z) || 1
            const k = Math.min(1, mag) * speed
            tx = (dir.x / len) * k
            tz = (dir.z / len) * k
          } else if (st.walk && !locked) {
            const w = st.walk
            // drop reached waypoints
            while (w.path.length && Math.hypot(w.path[0]!.x + 0.5 - t.x, w.path[0]!.z + 0.5 - t.z) < 0.2) w.path.shift()
            const next = w.path[0]
            if (next) {
              if (w.path.length > 6) speed = cfg.runSpeed
              const dx = next.x + 0.5 - t.x
              const dz = next.z + 0.5 - t.z
              const len = Math.hypot(dx, dz) || 1
              tx = (dx / len) * speed
              tz = (dz / len) * speed
            } else {
              st.walk = null
              if (w.target) {
                t.rotY = Math.atan2(w.target.x + 0.5 - t.x, w.target.z + 0.5 - t.z)
                if (w.act) api.events.emit('player:arrived', { x: w.target.x, z: w.target.z })
              }
            }
          }
          const speeding = tx * p.vx + tz * p.vz > 0 && Math.hypot(tx, tz) >= Math.hypot(p.vx, p.vz)
          const a = Math.min(1, (speeding ? cfg.acceleration : cfg.deceleration) * dt)
          p.vx += (tx - p.vx) * a
          p.vz += (tz - p.vz) * a
          if (!mag && Math.hypot(p.vx, p.vz) < 0.05) p.vx = p.vz = 0

          const body: Body = { x: t.x, y: t.y, z: t.z, vy: p.vy, grounded: p.grounded }
          moveBody(body, { radius: cfg.radius, height: cfg.height }, rules(), query, p.vx * dt, p.vz * dt, dt)
          // Velocity that actually happened (so walking into a wall doesn't keep the legs running).
          const realVx = (body.x - t.x) / dt
          const realVz = (body.z - t.z) / dt
          t.x = body.x
          t.y = body.y
          t.z = body.z
          p.vy = body.vy
          p.grounded = body.grounded

          const hs = Math.hypot(realVx, realVz)
          // Give up a click-walk that can't make progress (blocked by something new).
          if (st.walk) {
            st.walk.stuckFor = hs < 0.3 && Math.hypot(tx, tz) > 0.1 ? st.walk.stuckFor + dt : 0
            if (st.walk.stuckFor > 0.8) st.walk = null
          }
          // Footsteps (and puffs of dust when running) by the block underfoot.
          if (p.grounded && hs > 0.3) {
            stepDist += hs * dt
            const running = hs > cfg.walkSpeed * 1.2
            if (stepDist >= (running ? cfg.runStride : cfg.stride)) {
              stepDist = 0
              const under = api.world.getBlock(Math.floor(t.x), Math.round(t.y) - 1, Math.floor(t.z))
              const sound = blocks.get(under)?.sounds?.step
              if (sound) api.audio.play(sound, { at: t, volume: running ? 1 : 0.8 })
              if (running) api.fx.burst('core:dust', { x: t.x, y: t.y + 0.05, z: t.z })
            }
          } else stepDist = 0.6
          if (Math.hypot(tx, tz) > 0.1) {
            const want = Math.atan2(tx, tz)
            const diff = Math.atan2(Math.sin(want - t.rotY), Math.cos(want - t.rotY))
            t.rotY += diff * Math.min(1, cfg.turnSpeed * dt)
          }
          if (e.biped) e.biped.speed = hs / cfg.walkSpeed
        }
      },
    })

    api.commands.register({
      name: 'tp',
      description: 'Переместить игрока: tp x z (на землю) или tp spawn',
      usage: '<x> <z> | spawn',
      run: ([a, b]) => {
        const e = playerEntity(api)
        if (!e) throw new Error('no player')
        if (a === 'spawn') placeAtSpawn(api, e, query)
        else {
          const x = Number(a)
          const z = Number(b)
          if (Number.isNaN(x) || Number.isNaN(z)) throw new Error('x and z must be numbers')
          e.transform!.x = Math.floor(x) + 0.5
          e.transform!.z = Math.floor(z) + 0.5
          e.transform!.y = api.world.surfaceY(x, z)
        }
        const t = e.transform!
        return `player at ${t.x.toFixed(1)} ${t.y.toFixed(1)} ${t.z.toFixed(1)}`
      },
    })
  },

  start(api) {
    const cfg = api.config.define(Config)
    const query: WorldQuery = {
      solid: (x, y, z) => api.world.isSolid(x, y, z) || api.hooks.run('movement:blocked', false, { x, y, z }),
      liquid: (x, y, z) => api.registry('blocks').isTagged(api.world.getBlock(x, y, z), '#core:liquid'),
    }
    // Reuse the player restored from a save (or kept across a hot reload); otherwise create one.
    let e = playerEntity(api)
    if (!e) {
      e = api.entities.spawn('player:player', { transform: { x: 0, y: 0, z: 0, rotY: Math.PI / 4 } })
      placeAtSpawn(api, e, query)
    }
    const player = e
    api.render.follow(player)
    api.events.on('world:generated', () => placeAtSpawn(api, player, query))

    const cursor = new Cursor(api, cfg)
    const st = stateOf(api)
    // Mouse hover: show the hovered cell for a while after the mouse moves.
    // Re-pick only when the mouse or the camera moved (the ray walk is cheap, but not free).
    let hoverKey = ''
    let hoverCell: Cell | null = null
    const hovered = (): Cell | null => {
      const ptr = api.input.pointer
      if (!ptr.inside || api.ui.modalOpen.value || performance.now() - ptr.movedAt > cfg.hoverTimeout * 1000) return null
      const c = api.render.camera.target
      const f = api.render.camera.forwardXZ()
      const key = `${ptr.x},${ptr.y},${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)},${f.x.toFixed(3)},${api.engineConfig.camera.zoom}`
      if (key !== hoverKey) {
        hoverKey = key
        const hit = api.world.pick(ptr.x, ptr.y)
        hoverCell = hit ? { x: hit.x, z: hit.z } : null
      }
      return hoverCell
    }
    api.systems.add({
      id: 'cursor',
      phase: 'render',
      priority: 800,
      run: ({ dt }) => cursor.update(player, dt, st.walk?.target ?? hovered()),
    })
    api.ui.slot('hud.bottom', () => <Hint cursor={cursor} cfg={cfg} api={api} />)

    const act = (x: number, z: number, button: 'primary' | 'secondary' = 'primary') => {
      if (api.ui.modalOpen.value || player.biped?.action) return
      const ctx = { ...api.interactions.at(player, x, z), button }
      const def = api.interactions.perform(ctx)
      if (def && player.biped && def.anim !== 'none') player.biped.action = { name: def.anim ?? 'swing', t: 0 }
    }

    // Use: whatever the interaction matrix says for (held item × cell in front).
    const useKey = api.input.action('use', ['Space', 'Enter', 'Pad0'])
    api.input.on(useKey, () => act(cursor.front.x, cursor.front.z))
    // The second action: rotate, take, put away… (shown next to the main one in the hint).
    const altKey = api.input.action('useAlt', ['KeyF', 'Pad2'])
    api.input.on(altKey, () => act(cursor.front.x, cursor.front.z, 'secondary'))

    // Click: walk next to the clicked cell and act on it (or just walk there).
    const standY = (x: number, z: number): number | null => {
      const y = api.world.surfaceY(x, z)
      if (y <= 0 || query.liquid(x, y - 1, z) || query.liquid(x, y, z)) return null
      if (query.solid(x, y, z) || query.solid(x, y + 1, z)) return null
      return y
    }
    const canStep = (a: Cell, b: Cell) => {
      const ha = standY(a.x, a.z) ?? Math.round(player.transform!.y)
      const hb = standY(b.x, b.z)
      return hb !== null && hb - ha <= cfg.step && ha - hb <= cfg.maxDrop
    }
    const clickKey = api.input.action('click', ['Mouse0'])
    api.input.on(clickKey, () => {
      if (api.ui.modalOpen.value) return
      const hit = api.world.pick(api.input.pointer.x, api.input.pointer.y)
      if (!hit) return
      const target = { x: hit.x, z: hit.z }
      const t = player.transform!
      const start = { x: Math.floor(t.x), z: Math.floor(t.z) }
      const actsThere = !!api.interactions.find(api.interactions.at(player, target.x, target.z))
      const adjacent = (c: Cell) => Math.abs(c.x - target.x) + Math.abs(c.z - target.z) === 1
      const isGoal = actsThere || standY(target.x, target.z) === null ? adjacent : (c: Cell) => c.x === target.x && c.z === target.z
      const path = findPath(start, { canStep, isGoal, target, maxNodes: 5000 })
      if (!path) return api.audio.play('ui:close')
      st.walk = { path, target, act: actsThere, stuckFor: 0 }
    })
    api.events.on('player:arrived', ({ x, z }) => act(x, z))
  },
})

function playerEntity(api: PluginApi): Entity | undefined {
  for (const e of api.entities.world.with('player')) return e
  return undefined
}

/** Nearest dry, open spot to the island center. */
function placeAtSpawn(api: PluginApi, e: Entity, q: WorldQuery): void {
  const w = api.world
  const cx = Math.floor(w.sizeX / 2)
  const cz = Math.floor(w.sizeZ / 2)
  for (let r = 0; r < Math.max(w.sizeX, w.sizeZ) / 2; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        const x = cx + dx
        const z = cz + dz
        const y = w.surfaceY(x, z)
        if (y <= 0 || q.liquid(x, y - 1, z) || q.liquid(x, y, z) || q.solid(x, y + 1, z)) continue
        const t = e.transform!
        t.x = x + 0.5
        t.y = y
        t.z = z + 0.5
        if (e.player) e.player.vx = e.player.vz = e.player.vy = 0
        return
      }
    }
  }
}

type Three = PluginApi['render']['three']

/** What the hint shows: an action (with its key) or just the name of what is in front. */
interface HintState {
  action: string | null
  name: string | null
  /** Key shown next to the action. */
  key: string
  /** The second action (F) here, if any. */
  alt: string | null
}

/** Rounded-square marker on the cell in front of the player; resolves what "use" would do there. */
class Cursor {
  private mesh: InstanceType<Three['Mesh']>
  private last = ''
  private pos = { x: 0, y: 0, z: 0 }
  private time = 0
  /** Cell (column) in front of the player — what Space acts on. */
  front = { x: 0, z: 0 }
  /** Cell the marker shows (front, or the mouse-hovered / clicked one). */
  cell = { x: 0, z: 0 }
  readonly hint = signal<HintState>({ action: null, name: null, key: 'Space', alt: null })

  constructor(
    private api: PluginApi,
    private cfg: Config,
  ) {
    const T = api.render.three
    const tex = new T.CanvasTexture(cursorCanvas())
    tex.colorSpace = T.SRGBColorSpace
    const mat = api.render.stylize(new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: cfg.cursorColor }))
    this.mesh = api.render.add(new T.Mesh(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat))
    this.mesh.renderOrder = 2
  }

  update(e: Entity, dt: number, pointed: Cell | null = null): void {
    this.time += dt
    const t = e.transform
    const view = e.view
    const show = this.cfg.cursor && !this.api.ui.modalOpen.value && !!t && !!view
    this.mesh.visible = show
    if (!show) return
    ;(this.mesh.material as InstanceType<Three['MeshBasicMaterial']>).color.set(this.cfg.cursorColor)
    // The cell one step ahead in the facing direction.
    const fx = Math.sin(t.rotY)
    const fz = Math.cos(t.rotY)
    let cx = Math.floor(view.position.x + fx * 0.85)
    let cz = Math.floor(view.position.z + fz * 0.85)
    if (cx === Math.floor(view.position.x) && cz === Math.floor(view.position.z)) {
      cx = Math.floor(view.position.x + fx * 1.3)
      cz = Math.floor(view.position.z + fz * 1.3)
    }
    this.front.x = cx
    this.front.z = cz
    if (pointed) {
      cx = pointed.x
      cz = pointed.z
    }
    this.cell.x = cx
    this.cell.z = cz
    const ctx = this.api.interactions.at(e, cx, cz)
    const top = ctx.y + 1
    const k = Math.min(1, dt * 18)
    this.pos.x += (cx + 0.5 - this.pos.x) * k
    this.pos.z += (cz + 0.5 - this.pos.z) * k
    this.pos.y += (top + 0.03 - this.pos.y) * k
    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z)
    this.mesh.scale.setScalar(1 + Math.sin(this.time * 4) * 0.035)

    const def = this.api.interactions.find(ctx)
    const action = def ? this.api.interactions.label(def, ctx) : null
    const altCtx = { ...ctx, target: undefined, button: 'secondary' as const }
    const altDef = this.api.interactions.find(altCtx)
    const alt = altDef ? this.api.interactions.label(altDef, altCtx) : null
    const name = ctx.block !== this.api.world.AIR ? (this.api.registry('blocks').get(ctx.block)?.name ?? ctx.block) : null
    const key = `${cx},${top},${cz},${ctx.block}`
    if (key !== this.last) {
      this.last = key
      this.api.events.emit('player:target', { x: cx, y: ctx.y, z: cz, block: ctx.block })
    }
    const keyName = pointed ? 'ЛКМ' : 'Space'
    const h = this.hint.value
    if (h.action !== action || h.name !== name || h.key !== keyName || h.alt !== alt) this.hint.value = { action, name, key: keyName, alt }
  }
}

function Hint({ cursor, cfg, api }: { cursor: Cursor; cfg: Config; api: PluginApi }) {
  const h = cursor.hint.value
  if (!cfg.hint || api.ui.modalOpen.value || (!h.action && !h.name && !h.alt)) return null
  return (
    <ui.Pill>
      {h.action ? (
        <>
          <ui.Key>{h.key}</ui.Key>
          <span>{h.action}</span>
        </>
      ) : (
        !h.alt && <span style={{ opacity: 0.8 }}>{h.name}</span>
      )}
      {h.alt && (
        <>
          <ui.Key>F</ui.Key>
          <span>{h.alt}</span>
        </>
      )}
    </ui.Pill>
  )
}

function cursorCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const r = 14
  const m = 5
  g.lineWidth = 5
  g.strokeStyle = 'rgba(255,255,255,0.95)'
  g.fillStyle = 'rgba(255,255,255,0.18)'
  g.beginPath()
  g.roundRect(m, m, 64 - m * 2, 64 - m * 2, r)
  g.fill()
  g.stroke()
  return c
}
