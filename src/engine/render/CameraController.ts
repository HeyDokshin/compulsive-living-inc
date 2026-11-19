import { Vector3 } from 'three'
import type { EngineConfig } from '../engineConfig'
import type { Entities } from '../ecs/Entities'
import type { Input } from '../input/Input'
import type { Entity, TickContext } from '../types'
import type { WorldService } from '../world/WorldService'
import type { IsoCamera } from './IsoCamera'

const ACTIONS = {
  rotL: 'camera:rotateLeft',
  rotR: 'camera:rotateRight',
  up: 'camera:panUp',
  down: 'camera:panDown',
  left: 'camera:panLeft',
  right: 'camera:panRight',
}

/**
 * Where the camera looks: chases a followed entity (with look-ahead), or pans freely with keys.
 * Q/E rotate in 90° steps, the wheel zooms.
 */
export class CameraController {
  /** Entity the camera follows (`api.render.follow`). */
  follow: Entity | null = null
  /** False until the camera got a sensible place (island center or a followed entity). */
  placed = false
  /** Called after a wheel zoom (the debug panel shows the zoom value). */
  onZoom?: () => void
  private dir = new Vector3()
  private vel = new Vector3()
  private last = new Vector3()
  private goal = new Vector3()

  constructor(
    private iso: IsoCamera,
    private cfg: EngineConfig['camera'],
    private input: Input,
    private entities: Entities,
    private world: WorldService,
  ) {
    input.define(ACTIONS.rotL, ['KeyQ'], 'engine')
    input.define(ACTIONS.rotR, ['KeyE'], 'engine')
    input.define(ACTIONS.up, ['KeyW', 'ArrowUp'], 'engine')
    input.define(ACTIONS.down, ['KeyS', 'ArrowDown'], 'engine')
    input.define(ACTIONS.left, ['KeyA', 'ArrowLeft'], 'engine')
    input.define(ACTIONS.right, ['KeyD', 'ArrowRight'], 'engine')
    input.on(ACTIONS.rotL, () => iso.rotate(-1))
    input.on(ACTIONS.rotR, () => iso.rotate(1))
  }

  /** Point the camera at the middle of the island. */
  center(): void {
    const v = this.world.voxels
    const x = v.sizeX / 2
    const z = v.sizeZ / 2
    this.iso.target.set(x, this.world.surfaceY(x, z), z)
    this.placed = true
  }

  update(ctx: TickContext): void {
    const { iso, cfg } = this
    const fe = this.follow
    if (fe && this.entities.world.has(fe) && fe.view) {
      // Smoothed velocity of the followed view → look ahead in the direction of travel.
      const pos = fe.view.position
      if (ctx.dt > 0) {
        const kv = 1 - Math.exp(-6 * ctx.dt)
        this.vel.x += ((pos.x - this.last.x) / ctx.dt - this.vel.x) * kv
        this.vel.z += ((pos.z - this.last.z) / ctx.dt - this.vel.z) * kv
      }
      this.last.copy(pos)
      if (Math.hypot(this.vel.x, this.vel.z) > 30) this.vel.set(0, 0, 0) // a teleport, not travel
      this.goal.set(pos.x + this.vel.x * cfg.lookAhead, pos.y + cfg.focusHeight, pos.z + this.vel.z * cfg.lookAhead)
      iso.target.lerp(this.goal, 1 - Math.exp(-cfg.followSmoothing * ctx.dt))
    } else {
      const i = this.input
      const r = Number(i.isDown(ACTIONS.right)) - Number(i.isDown(ACTIONS.left))
      const u = Number(i.isDown(ACTIONS.up)) - Number(i.isDown(ACTIONS.down))
      if (r || u) {
        iso.screenToWorldDir(r, u, this.dir).normalize()
        iso.target.addScaledVector(this.dir, (cfg.panSpeed / cfg.zoom) * ctx.dt)
        const v = this.world.voxels
        iso.target.x = Math.max(0, Math.min(v.sizeX, iso.target.x))
        iso.target.z = Math.max(0, Math.min(v.sizeZ, iso.target.z))
      }
      // Ease the focus height towards the ground under it.
      const ground = this.world.surfaceY(iso.target.x, iso.target.z)
      iso.target.y += (ground - iso.target.y) * Math.min(1, ctx.dt * 4)
    }
    const wheel = this.input.consumeWheel()
    if (wheel) {
      iso.zoomBy(wheel)
      this.onZoom?.()
    }
  }
}
