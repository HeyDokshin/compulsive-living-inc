/**
 * Conversations as little scenes: when a dialogue opens, the camera glides down from the island view
 * to a low close-up of the two characters, the player steps up and both turn to each other, black
 * bars slide in, and the faces come alive — the one speaking moves their lips and shows what the
 * line says, the other reacts. The camera leans over the listener's shoulder towards whoever is
 * talking (shot / reverse shot) and everything in front of them is cut away.
 *
 * Plugins mark their dialogue windows with `cutscene:talk.conversation(windowId, () => who)` and
 * report lines and typing (`line`, `typing`); the rest happens here. The player can turn the
 * close-ups off in the settings; faces still play then.
 */
import { definePlugin, signal, z, type Entity, type PluginApi, type Services } from '@sdk'
import { shotFor, type ShotInput } from './shot'

type Obj = InstanceType<PluginApi['render']['three']['Object3D']>
/** A character: an entity, or a rig object a plugin placed itself (the shopkeeper). */
type Target = Entity | Obj
type Expression = NonNullable<ReturnType<Services['faces:control']['ofLine']>>

export interface Cutscene {
  /** While window `windowId` is open, it is a conversation with `who()` (an entity or a rig object). */
  conversation(windowId: string, who: () => Target | null | undefined): void
  /** Start a conversation by hand (it ends with `end`). */
  begin(who: Target): void
  /** A line they say: their face shows what it says (a leading `[joy]` tag wins). */
  line(text: string): void
  /** Their line is being typed: lips move, the camera turns to them; done — it turns to the player. */
  typing(on: boolean): void
  end(): void
  readonly active: boolean
  /**
   * "Cheating to the camera": an angle someone faces in the scene (rotY) turned part of the way
   * towards the camera, so faces read on screen while they still look at each other.
   */
  cheat(rotY: number): number
}

declare module '@sdk' {
  interface Services {
    'cutscene:talk': Cutscene
  }
}

const OPTION = 'cutscene:closeups'

const Config = z.object({
  /** Seconds to glide into the close-up and back out. */
  blendIn: z.number().min(0.05).max(4).default(0.9).meta({ label: 'blend in (s)', step: 0.05 }),
  blendOut: z.number().min(0.05).max(4).default(0.7).meta({ label: 'blend out (s)', step: 0.05 }),
  /** Zoom of the close-up (the usual view is 1…6). */
  zoom: z.number().min(1).max(20).default(7.5).meta({ step: 0.1 }),
  /** The two fit when they stand this far apart (blocks); farther apart, the shot widens. */
  fit: z.number().min(0.5).max(8).default(1.8).meta({ step: 0.1 }),
  /** Camera height in degrees above the ground (the island view is higher). */
  pitch: z.number().min(2).max(60).default(15).meta({ step: 1 }),
  /** Degrees the camera turns from the side view to look over the listener's shoulder. */
  overShoulder: z.number().min(0).max(80).default(35).meta({ label: 'over the shoulder (°)', step: 1 }),
  /** Where the shot looks between the two: towards the one speaking. */
  leanSpeaker: z.number().min(0).max(0.5).default(0.14).meta({ label: 'lean to speaker', step: 0.01 }),
  /** Gap kept on screen between the listener's head and the speaker's face (blocks). */
  clearance: z.number().min(0).max(2).default(1.25).meta({ step: 0.05 }),
  /** Height of the faces above the feet (blocks). */
  eyeHeight: z.number().min(0).max(3).default(0.95).meta({ step: 0.05 }),
  /** Everything nearer to the camera than this many blocks in front of the focus is cut away. */
  clip: z.number().min(0.5).max(30).default(2.2).meta({ step: 0.1 }),
  /** How quickly the shot follows speaker changes (1/s). */
  follow: z.number().min(0.5).max(20).default(2.6).meta({ step: 0.1 }),
  /** The player steps up to this distance from whom they talk to (blocks)… */
  talkDistance: z.number().min(0.6).max(4).default(1.35).meta({ label: 'talk distance', step: 0.05 }),
  /** …at this pace (blocks/s). */
  stepSpeed: z.number().min(0.2).max(6).default(1.6).meta({ label: 'step speed', step: 0.1 }),
  /** How quickly both turn to face each other (1/s). */
  turnSpeed: z.number().min(0.5).max(30).default(8).meta({ label: 'turn speed', step: 0.5 }),
  /** Degrees both turn from each other towards the camera ("cheating"), so their faces show. */
  cheat: z.number().min(0).max(60).default(28).meta({ step: 1 }),
  /** Seconds a line's expression stays on the speaker's face. */
  lineSeconds: z.number().min(0.5).max(20).default(4).meta({ step: 0.1 }),
  /** Height of each black bar (share of the screen). */
  bars: z.number().min(0).max(0.25).default(0.085).meta({ step: 0.005 }),
})

/** How the player's face answers what they hear. */
const ECHO: Partial<Record<Expression, Expression>> = {
  joy: 'happy',
  love: 'shy',
  happy: 'happy',
  sad: 'worried',
  surprised: 'surprised',
  angry: 'worried',
  worried: 'worried',
}

export default definePlugin({
  id: 'cutscene',
  version: '0.1.0',
  description: 'Разговоры крупным планом: камера, полосы, повороты и мимика',
  optionalDependsOn: ['faces'],

  setup(api) {
    const cfg = api.config.define(Config)
    const T = api.render.three
    const cam = api.render.camera
    const faces = () => (api.services.has('faces:control') ? api.services.get('faces:control') : null)
    const windows = new Map<string, () => Target | null | undefined>()
    const bars = signal(false)

    api.registry('options').register({
      id: OPTION,
      order: 20,
      label: 'Разговоры крупным планом',
      hint: 'Камера опускается к собеседникам, по краям — полосы как в кино.',
      choices: [
        [true, 'Да'],
        [false, 'Нет'],
      ],
      default: true,
    })
    const closeups = () => api.options.get(OPTION) !== false

    // --- the scene ---------------------------------------------------------------------------------
    let who: Target | null = null
    let speaking = false
    let window_: string | null = null
    const player = () => {
      for (const e of api.entities.world.with('player', 'transform')) return e
      return undefined
    }
    const isObj = (t: Target): t is Obj => (t as Obj).isObject3D === true
    const pos = new T.Vector3()
    const posOf = (t: Target, out: typeof pos): boolean => {
      if (isObj(t)) {
        t.getWorldPosition(out)
        return true
      }
      const tr = t.transform
      if (!tr) return false
      out.set(tr.x, tr.y, tr.z)
      return true
    }

    const begin = (t: Target) => {
      const p = player()
      if (!p) return
      who = t
      speaking = false
      flip = false
      checked = false
      startYaw = cam.viewYaw
      const f = faces()
      f?.look(t, p)
      f?.look(p, t)
      if (!closeups()) return
      // start the shot where the camera is now: no jump
      cam.shot.target.copy(cam.target)
      cam.shot.yaw = cam.viewYaw
      cam.shot.pitch = cam.viewPitch
      cam.shot.zoom = cam.shownZoom
      cam.shot.clip = cfg.clip
      cam.cut(true, cfg.blendIn)
      bars.value = true
      api.ui.cinema.value = true
    }
    const end = () => {
      if (!who) return
      const f = faces()
      const p = player()
      f?.look(who, null)
      f?.talk(who, false)
      if (p) f?.look(p, null)
      who = null
      window_ = null
      cam.cut(false, cfg.blendOut)
      bars.value = false
      api.ui.cinema.value = false
    }

    const service: Cutscene = {
      conversation: (id, fn) => void windows.set(id, fn),
      begin,
      end,
      line(text) {
        if (!who) return
        const f = faces()
        const expr = f?.ofLine(text)
        if (!f || !expr) return
        f.show(who, expr, cfg.lineSeconds)
        // body language for entities with a two-legged rig
        const e = isObj(who) ? null : (who as Entity)
        if (e?.biped && !e.biped.action) {
          if (expr === 'joy' || expr === 'love') e.biped.action = { name: 'cheer', t: 0 }
          else if (expr === 'sad') e.biped.action = { name: 'sad', t: 0 }
          else if (Math.random() < 0.4) e.biped.action = { name: 'nod', t: 0 }
        }
        const echo = ECHO[expr]
        const p = player()
        if (echo && p) f.show(p, echo, cfg.lineSeconds * 0.6)
      },
      typing(on) {
        speaking = on
        if (who) faces()?.talk(who, on)
      },
      get active() {
        return who !== null
      },
      cheat(rotY) {
        if (!who || cam.shotWeight === 0) return rotY
        // the camera looks along -(sin yaw, cos yaw): facing it means rotY = viewYaw
        const toCam = (cam.viewYaw * Math.PI) / 180
        const d = Math.atan2(Math.sin(toCam - rotY), Math.cos(toCam - rotY))
        const most = (cfg.cheat * Math.PI) / 180
        return rotY + Math.max(-most, Math.min(most, d)) * cam.shotWeight
      },
    }
    api.services.provide('cutscene:talk', service)

    api.events.on('ui:opened', ({ id }) => {
      const fn = windows.get(id)
      const t = fn?.()
      if (!t) return
      end()
      window_ = id
      begin(t)
    })
    api.events.on('ui:closed', ({ id }) => {
      if (id === window_) end()
    })

    // --- every frame: the shot follows the two, they face each other --------------------------------
    const p0 = new T.Vector3()
    const n0 = new T.Vector3()
    const input: ShotInput = { px: 0, py: 0, pz: 0, nx: 0, ny: 0, nz: 0, speaking: false, viewYaw: 45, flip: false, cfg }
    /** Side of the shot chosen at the start (and kept unless it gets blocked). */
    let flip = false
    let lastSpeaking = false
    let checked = false
    let startYaw = 45
    api.systems.add({
      id: 'shot',
      phase: 'render',
      priority: 100,
      run: ({ dt }) => {
        const t = who
        const p = player()
        if (!t || !p?.transform || !posOf(t, n0)) return
        const pt = p.transform
        // step up and turn to each other
        const dx = n0.x - pt.x
        const dz = n0.z - pt.z
        const dist = Math.hypot(dx, dz)
        if (dist > cfg.talkDistance + 0.02 && dist < 4) {
          const step = Math.min(dist - cfg.talkDistance, cfg.stepSpeed * dt)
          const nx = pt.x + (dx / dist) * step
          const nz = pt.z + (dz / dist) * step
          const cx = Math.floor(nx)
          const cz = Math.floor(nz)
          // only onto free, level ground
          if (
            Math.abs(api.world.surfaceY(cx, cz) - pt.y) < 0.01 &&
            !api.world.blockerAt(cx, cz) &&
            !api.hooks.run('movement:blocked', false, { x: cx, y: Math.round(pt.y), z: cz })
          ) {
            pt.x = nx
            pt.z = nz
          }
        }
        const k = Math.min(1, cfg.turnSpeed * dt)
        turn(pt, service.cheat(Math.atan2(dx, dz)), k)
        if (!isObj(t) && t.transform && !t.villager) turn(t.transform, service.cheat(Math.atan2(-dx, -dz)), k)
        if (!closeups() || (cam.shotWeight === 0 && !bars.value)) return
        p0.set(pt.x, pt.y, pt.z)
        input.px = p0.x
        input.py = p0.y
        input.pz = p0.z
        input.nx = n0.x
        input.ny = n0.y
        input.nz = n0.z
        input.speaking = speaking
        // sides are chosen against the view the conversation started from (the shot moves the view)
        input.viewYaw = startYaw
        // pick a side the camera can see the two from (re-checked when the speaker changes)
        if (!checked || speaking !== lastSpeaking) {
          input.flip = flip
          const here = blocked(shotFor(input), n0, p0)
          if (here > 0) {
            input.flip = !flip
            if (blocked(shotFor(input), n0, p0) < here) flip = !flip
          }
          checked = true
          lastSpeaking = speaking
        }
        input.flip = flip
        const goal = shotFor(input)
        // ease towards it, so speaker changes are camera moves, not cuts
        const f = 1 - Math.exp(-cfg.follow * dt)
        const s = cam.shot
        s.target.x += (goal.x - s.target.x) * f
        s.target.y += (goal.y - s.target.y) * f
        s.target.z += (goal.z - s.target.z) * f
        s.yaw += (((((goal.yaw - s.yaw) % 360) + 540) % 360) - 180) * f
        s.pitch += (goal.pitch - s.pitch) * f
        s.zoom *= Math.pow(goal.zoom / s.zoom, f)
        s.clip = cfg.clip
      },
    })
    api.onDispose(() => {
      cam.cut(false, 0.01)
    })

    /** Something standing at (x, z) reaches height y — a tree's crown spreads over the cells around it too. */
    const standsThere = (x: number, y: number, z: number): boolean => {
      const ground = api.world.surfaceY(x, z)
      const tall = (b: Entity | undefined) => !!b && y < ground + (b.blocker?.h ?? 3)
      if (tall(api.world.blockerAt(x, z))) return true
      if (y < ground + 1.2) return false
      return (
        tall(api.world.blockerAt(x + 1, z)) || tall(api.world.blockerAt(x - 1, z)) || tall(api.world.blockerAt(x, z + 1)) || tall(api.world.blockerAt(x, z - 1))
      )
    }

    /** How much blocks or things standing there hide the faces from this shot (0 = a clear view). */
    const blocked = (s: { yaw: number; pitch: number }, speaker: typeof pos, listener: typeof pos): number => {
      const yaw = (s.yaw * Math.PI) / 180
      const pitch = (s.pitch * Math.PI) / 180
      const ux = Math.sin(yaw) * Math.cos(pitch)
      const uz = Math.cos(yaw) * Math.cos(pitch)
      const uy = Math.sin(pitch)
      // walk from each face towards the camera, up to where the shot cuts things away; the speaker's
      // face and near things count more
      // across the screen: a head is about a block wide, so look past both its sides too
      const rx = Math.cos(yaw)
      const rz = -Math.sin(yaw)
      let score = 0
      for (let ray = 0; ray < 6; ray++) {
        const f = ray < 3 ? speaker : listener
        const weight = ray < 3 ? 2 : 1
        const side = ((ray % 3) - 1) * 0.4
        for (let d = 0.45; d < cfg.clip; d += 0.25) {
          const x = Math.floor(f.x + rx * side + ux * d)
          const y = f.y + cfg.eyeHeight + uy * d
          const z = Math.floor(f.z + rz * side + uz * d)
          // at face height and at body height
          const hit = api.world.isSolid(x, Math.floor(y), z) || api.world.isSolid(x, Math.floor(y - 0.6), z) || standsThere(x, y, z)
          if (hit) score += (cfg.clip - d) * weight
        }
      }
      return score
    }

    // --- black bars --------------------------------------------------------------------------------
    api.ui.slot('screen', () => {
      const h = `${(bars.value ? cfg.bars : 0) * 100}vh`
      const bar = { position: 'absolute', left: 0, right: 0, height: h, background: '#120d14', transition: 'height 0.6s ease' } as const
      return (
        <>
          <div style={{ ...bar, top: 0 }} />
          <div style={{ ...bar, bottom: 0 }} />
        </>
      )
    })
  },
})

function turn(t: { rotY: number }, want: number, k: number): void {
  const d = Math.atan2(Math.sin(want - t.rotY), Math.cos(want - t.rotY))
  t.rotY += d * k
}
