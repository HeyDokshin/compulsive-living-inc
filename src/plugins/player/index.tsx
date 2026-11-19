/**
 * The player: camera-relative movement (keyboard or gamepad), voxel collision with auto-step,
 * no walking off cliffs or into water, smooth turning, camera follow, a soft cursor on the
 * cell in front of the player, and the "use" button that runs the interaction matrix there.
 */
import { definePlugin, signal, ui, z, type Entity, type PluginApi } from '@sdk'
import { moveBody, type Body, type MoveRules, type WorldQuery } from './physics'

declare module '@sdk' {
  interface Components {
    player?: { vx: number; vz: number; vy: number; grounded: boolean }
  }
  interface GameEvents {
    /** The cell in front of the player changed. */
    'player:target': { x: number; y: number; z: number; block: string }
  }
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
          const speed = api.input.isDown(keys.run) ? cfg.runSpeed : cfg.walkSpeed
          let tx = 0
          let tz = 0
          if (mag > 0.01) {
            api.render.camera.screenToWorldDir(r, u, dir)
            const len = Math.hypot(dir.x, dir.z) || 1
            const k = Math.min(1, mag) * speed
            tx = (dir.x / len) * k
            tz = (dir.z / len) * k
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
    api.systems.add({ id: 'cursor', phase: 'render', priority: 800, run: ({ dt }) => cursor.update(player, dt) })
    api.ui.slot('hud.bottom', () => <Hint cursor={cursor} cfg={cfg} api={api} />)

    // Use: whatever the interaction matrix says for (held item × cell in front).
    const useKey = api.input.action('use', ['Space', 'Enter', 'Pad0'])
    api.input.on(useKey, () => {
      if (api.ui.modalOpen.value || player.biped?.action) return
      const ctx = api.interactions.at(player, cursor.cell.x, cursor.cell.z)
      const def = api.interactions.perform(ctx)
      if (def && player.biped && def.anim !== 'none') player.biped.action = { name: def.anim ?? 'swing', t: 0 }
    })
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
}

/** Rounded-square marker on the cell in front of the player; resolves what "use" would do there. */
class Cursor {
  private mesh: InstanceType<Three['Mesh']>
  private last = ''
  private pos = { x: 0, y: 0, z: 0 }
  private time = 0
  /** Target cell (column) in front of the player. */
  cell = { x: 0, z: 0 }
  readonly hint = signal<HintState>({ action: null, name: null })

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

  update(e: Entity, dt: number): void {
    this.time += dt
    const t = e.transform
    const view = e.view
    const show = this.cfg.cursor && !!t && !!view
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
    const name = ctx.block !== this.api.world.AIR ? (this.api.registry('blocks').get(ctx.block)?.name ?? ctx.block) : null
    const key = `${cx},${top},${cz},${ctx.block}`
    if (key !== this.last) {
      this.last = key
      this.api.events.emit('player:target', { x: cx, y: ctx.y, z: cz, block: ctx.block })
    }
    const h = this.hint.value
    if (h.action !== action || h.name !== name) this.hint.value = { action, name }
  }
}

function Hint({ cursor, cfg, api }: { cursor: Cursor; cfg: Config; api: PluginApi }) {
  const h = cursor.hint.value
  if (!cfg.hint || api.ui.modalOpen.value || (!h.action && !h.name)) return null
  return (
    <ui.Pill>
      {h.action ? (
        <>
          <ui.Key>Space</ui.Key>
          <span>{h.action}</span>
        </>
      ) : (
        <span style={{ opacity: 0.8 }}>{h.name}</span>
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
