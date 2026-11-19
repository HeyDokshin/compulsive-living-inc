/**
 * Procedural animation for two-legged rigs (player now, villagers later).
 * Any entity with a rig view and a `biped` component walks, swings its arms and breathes.
 * Gameplay code only sets `biped.speed` (0 = idle, 1 = walking pace, >1 = running) and starts
 * one-shot actions with `biped.action = { name: 'swing' | 'pickup', t: 0 }`.
 */
import { definePlugin, z, type Entity } from '@sdk'

declare module '@sdk' {
  interface Components {
    biped?: {
      speed: number
      phase?: number
      blend?: number
      /** One-shot action animation: set `{ name, t: 0 }`, the animation advances `t` and clears it. */
      action?: { name: 'swing' | 'pickup'; t: number; duration?: number } | null
    }
  }
}

const Config = z.object({
  stride: z.number().min(1).max(30).default(11).meta({ label: 'steps per unit speed', step: 0.5 }),
  legSwing: z.number().min(0).max(1.5).default(0.75).meta({ label: 'leg swing (rad)', step: 0.05 }),
  armSwing: z.number().min(0).max(1.5).default(0.6).meta({ label: 'arm swing (rad)', step: 0.05 }),
  bob: z.number().min(0).max(2).default(0.55).meta({ label: 'bounce (voxels)', step: 0.05 }),
  breathe: z.number().min(0).max(1).default(0.18).meta({ label: 'idle breathing', step: 0.01 }),
  blendSpeed: z.number().min(1).max(30).default(10).meta({ label: 'walk/idle blend', step: 0.5 }),
})

interface Parts {
  legL?: PartRef
  legR?: PartRef
  armL?: PartRef
  armR?: PartRef
  body?: PartRef
  head?: PartRef
}
interface PartRef {
  obj: { rotation: { x: number; z: number }; position: { y: number } }
  restY: number
}

export default definePlugin({
  id: 'characters',
  version: '0.1.0',
  description: 'Процедурная анимация двуногих ригов (ходьба, бег, дыхание)',

  setup(api) {
    const cfg = api.config.define(Config)
    api.components.define(
      'biped',
      z.object({
        speed: z.number().default(0),
        phase: z.number().optional(),
        blend: z.number().optional(),
        action: z.object({ name: z.enum(['swing', 'pickup']), t: z.number(), duration: z.number().optional() }).nullable().optional(),
      }),
    )
    const cache = new WeakMap<object, Parts>()

    const partsOf = (e: Entity): Parts => {
      const view = e.view!
      let p = cache.get(view)
      if (!p || !p.body) {
        p = {}
        for (const name of ['legL', 'legR', 'armL', 'armR', 'body', 'head'] as const) {
          const obj = view.getObjectByName(name)
          if (obj) p[name] = { obj, restY: obj.position.y }
        }
        cache.set(view, p)
      }
      return p
    }

    let time = 0
    api.systems.add({
      id: 'biped',
      phase: 'render',
      priority: 500,
      run: ({ dt }) => {
        time += dt
        for (const e of api.entities.world.with('biped', 'view')) {
          const b = e.biped
          const moving = Math.min(1.5, Math.max(0, b.speed))
          b.blend = (b.blend ?? 0) + ((moving > 0.05 ? 1 : 0) - (b.blend ?? 0)) * Math.min(1, cfg.blendSpeed * dt)
          b.phase = ((b.phase ?? 0) + dt * cfg.stride * Math.max(0.35, moving) * (moving > 0.05 ? 1 : 0)) % (Math.PI * 2)
          const k = b.blend
          const s = Math.sin(b.phase)
          const p = partsOf(e)
          const swing = Math.min(1.3, 0.75 + moving * 0.35)
          if (p.legL) p.legL.obj.rotation.x = s * cfg.legSwing * k * swing
          if (p.legR) p.legR.obj.rotation.x = -s * cfg.legSwing * k * swing
          if (p.armL) p.armL.obj.rotation.x = -s * cfg.armSwing * k * swing
          if (p.armR) p.armR.obj.rotation.x = s * cfg.armSwing * k * swing
          const breath = Math.sin(time * 2.2 + (e.uid ?? 0)) * cfg.breathe * (1 - k)
          if (p.body) p.body.obj.position.y = p.body.restY + Math.abs(Math.cos(b.phase)) * cfg.bob * k + breath
          if (p.head) {
            p.head.obj.rotation.z = Math.sin(b.phase) * 0.06 * k + Math.sin(time * 0.9 + (e.uid ?? 0)) * 0.03 * (1 - k)
            p.head.obj.rotation.x = Math.sin(time * 1.3) * 0.02 * (1 - k)
          }
          if (p.body) p.body.obj.rotation.x = 0

          // One-shot actions layered on top.
          const act = b.action
          if (act) {
            const dur = act.duration ?? (act.name === 'swing' ? 0.42 : 0.5)
            act.t += dt
            const f = Math.min(1, act.t / dur)
            const arc = Math.sin(f * Math.PI)
            if (act.name === 'swing' && p.armR) {
              // raise the tool, then chop down and forward
              p.armR.obj.rotation.x = f < 0.35 ? -2.4 * (f / 0.35) : -2.4 + 3.2 * ((f - 0.35) / 0.65)
              if (f > 0.85) p.armR.obj.rotation.x *= 1 - (f - 0.85) / 0.15
              if (p.body) p.body.obj.rotation.x = arc * 0.12
            }
            if (act.name === 'pickup') {
              if (p.body) p.body.obj.rotation.x = arc * 0.45
              if (p.armL) p.armL.obj.rotation.x = -arc * 0.9
              if (p.armR) p.armR.obj.rotation.x = -arc * 0.9
              if (p.head) p.head.obj.rotation.x = arc * 0.2
            }
            if (f >= 1) b.action = null
          }
        }
      },
    })
  },
})
