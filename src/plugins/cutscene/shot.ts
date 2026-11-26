/** Where a conversation close-up looks from (pure: tested without three.js). */

export interface ShotSettings {
  zoom: number
  fit: number
  pitch: number
  overShoulder: number
  leanSpeaker: number
  eyeHeight: number
  /** Gap kept on screen between the listener's head and the speaker's face (blocks). */
  clearance: number
}

export interface ShotInput {
  /** The player's feet. */
  px: number
  py: number
  pz: number
  /** Whom they talk to. */
  nx: number
  ny: number
  nz: number
  /** True while the other one speaks; false while the player answers. */
  speaking: boolean
  /** Camera yaw now (degrees): of the two side views, the nearer one is taken… */
  viewYaw: number
  /** …or the other one (when the nearer one is blocked by a wall or a tree). */
  flip: boolean
  cfg: ShotSettings
}

export interface Shot {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  zoom: number
}

const out: Shot = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, zoom: 1 }
const DEG = 180 / Math.PI
/** a − b in degrees, in (−180, 180]. */
export const angleDiff = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180

/**
 * A two-shot from the side, turned over the listener's shoulder towards the speaker, looking at
 * a point between their faces nudged towards the speaker. Yaw follows the camera convention: the
 * camera sits at (sin yaw, cos yaw) from what it looks at. Returns a shared object (no garbage).
 */
export function shotFor(i: ShotInput): Shot {
  const c = i.cfg
  const dx = i.nx - i.px
  const dz = i.nz - i.pz
  const dist = Math.hypot(dx, dz)
  // the side views: camera perpendicular to the line between them
  const side = Math.atan2(-dz, dx) * DEG
  const near = Math.abs(angleDiff(side, i.viewYaw)) <= 90
  const sideYaw = near !== i.flip ? side : side + 180
  // over the shoulder: towards the camera being behind the listener
  const behindListener = i.speaking ? Math.atan2(-dx, -dz) * DEG : Math.atan2(dx, dz) * DEG
  // the listener's head must not cover the speaker's face: on screen they stand dist·cos(turn) apart
  const most = dist > c.clearance ? Math.acos(c.clearance / dist) * DEG : 0
  const turn = Math.sign(angleDiff(behindListener, sideYaw)) * Math.min(c.overShoulder, most)
  out.yaw = (((sideYaw + turn) % 360) + 360) % 360
  const lean = 0.5 + (i.speaking ? c.leanSpeaker : -c.leanSpeaker)
  out.x = i.px + dx * lean
  out.z = i.pz + dz * lean
  out.y = i.py + (i.ny - i.py) * lean + c.eyeHeight
  out.pitch = c.pitch
  out.zoom = c.zoom * Math.min(1, c.fit / Math.max(0.1, dist))
  return out
}
