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
  /** Title screen: a slow drift around the island instead of following and panning. */
  cinematic: { zoom: number; orbit: number; orbitSpeed: number } | null = null
  /** Rooms are small: the drift holds still inside one. */
  insideRoom: () => boolean = () => false
  private angle = 0
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
    input.define(ACTIONS.rotL, ['KeyZ', 'Pad6'], 'engine', 'Камера: повернуть влево')
    input.define(ACTIONS.rotR, ['KeyX', 'Pad7'], 'engine', 'Камера: повернуть вправо')
    input.define(ACTIONS.up, ['KeyW', 'ArrowUp'], 'engine')
    input.define(ACTIONS.down, ['KeyS', 'ArrowDown'], 'engine')
    input.define(ACTIONS.left, ['KeyA', 'ArrowLeft'], 'engine')
    input.define(ACTIONS.right, ['KeyD', 'ArrowRight'], 'engine')
    input.on(ACTIONS.rotL, () => !this.cinematic && iso.rotate(-1))
    input.on(ACTIONS.rotR, () => !this.cinematic && iso.rotate(1))
  }

  /** Point the camera at the middle of the island. */
  center(): void {
    const v = this.world.voxels
    const x = v.sizeX / 2
    const z = v.sizeZ / 2
    this.iso.target.set(x, this.world.surfaceY(x, z), z)
    this.placed = true
  }

  /** Jump straight to the followed entity (after a teleport: no sweep across the map). */
  snap(): void {
    const fe = this.follow
    if (!fe?.transform) return
    this.iso.target.set(fe.transform.x, fe.transform.y + this.cfg.focusHeight, fe.transform.z)
    this.last.set(fe.transform.x, fe.transform.y, fe.transform.z)
    this.vel.set(0, 0, 0)
  }

  update(ctx: TickContext): void {
    const { iso, cfg } = this
    const fe = this.follow
    const drift = this.insideRoom() ? null : this.cinematic
    iso.zoomOverride = drift ? drift.zoom : null
    if (drift) {
      const v = this.world.voxels
      this.angle += ((drift.orbitSpeed * Math.PI) / 180) * ctx.dt
      const x = v.sizeX / 2 + Math.cos(this.angle) * drift.orbit
      const z = v.sizeZ / 2 + Math.sin(this.angle) * drift.orbit
      this.goal.set(x, this.world.surfaceY(v.sizeX / 2, v.sizeZ / 2), z)
      // Far away (the title just opened): cut, don't sweep.
      if (iso.target.distanceToSquared(this.goal) > 9) iso.target.copy(this.goal)
      else iso.target.lerp(this.goal, Math.min(1, ctx.dt * 2))
    } else if (fe && this.entities.world.has(fe) && fe.view) {
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
    if (wheel && !this.cinematic) {
      iso.zoomBy(wheel)
      this.onZoom?.()
    }
  }
}
