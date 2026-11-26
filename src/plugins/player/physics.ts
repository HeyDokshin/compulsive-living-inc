/**
 * Character movement against the voxel world (pure, testable).
 * Cozy-game rules: climb up to `step` blocks automatically, never walk off a ledge higher than
 * `maxDrop`, and don't walk into water when `waterBlocks` is on.
 */

export interface Body {
  x: number
  y: number
  z: number
  vy: number
  grounded: boolean
}

export interface BodyShape {
  /** Half width of the square footprint. */
  radius: number
  height: number
}

export interface MoveRules {
  step: number
  maxDrop: number
  gravity: number
  waterBlocks: boolean
}

export interface WorldQuery {
  solid(x: number, y: number, z: number): boolean
  liquid(x: number, y: number, z: number): boolean
}

const EPS = 1e-4

/** Does the box at (x, y, z) overlap any solid cell? */
export function boxHits(q: WorldQuery, s: BodyShape, x: number, y: number, z: number): boolean {
  const x0 = Math.floor(x - s.radius + EPS)
  const x1 = Math.floor(x + s.radius - EPS)
  const z0 = Math.floor(z - s.radius + EPS)
  const z1 = Math.floor(z + s.radius - EPS)
  const y0 = Math.floor(y + EPS)
  const y1 = Math.floor(y + s.height - EPS)
  for (let cy = y0; cy <= y1; cy++) {
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) if (q.solid(cx, cy, cz)) return true
    }
  }
  return false
}

/** Top of the first solid or liquid cell under (x, z) at or below `y`, looking at most `depth` cells down. */
export function groundBelow(q: WorldQuery, x: number, y: number, z: number, depth: number): { y: number; liquid: boolean } | null {
  const cx = Math.floor(x)
  const cz = Math.floor(z)
  const start = Math.floor(y + EPS) - 1
  for (let cy = start; cy >= Math.max(0, start - depth); cy--) {
    if (q.solid(cx, cy, cz)) return { y: cy + 1, liquid: false }
    if (q.liquid(cx, cy, cz)) return { y: cy + 1, liquid: true }
  }
  return null
}

/** Highest support under the whole footprint (what the body actually rests on). */
export function groundUnderBox(q: WorldQuery, s: BodyShape, x: number, y: number, z: number, depth: number): number | null {
  let best: number | null = null
  const x0 = Math.floor(x - s.radius + EPS)
  const x1 = Math.floor(x + s.radius - EPS)
  const z0 = Math.floor(z - s.radius + EPS)
  const z1 = Math.floor(z + s.radius - EPS)
  for (let cz = z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) {
      const g = groundBelow(q, cx + 0.5, y, cz + 0.5, depth)
      if (g && (best === null || g.y > best)) best = g.y
    }
  }
  return best
}

/** Could the body stand at this spot without dropping too far or wading into water? */
export function canStand(q: WorldQuery, r: MoveRules, x: number, y: number, z: number): boolean {
  const g = groundBelow(q, x, y, z, r.maxDrop + 1)
  if (!g) return false
  if (g.liquid && r.waterBlocks) return false
  return y - g.y <= r.maxDrop + EPS
}

/** Move by (dx, dz) this tick with sliding, auto-step and gravity. Mutates `b`. */
export function moveBody(b: Body, s: BodyShape, r: MoveRules, q: WorldQuery, dx: number, dz: number, dt: number): void {
  for (const axis of ['x', 'z'] as const) {
    const d = axis === 'x' ? dx : dz
    if (!d) continue
    const nx = axis === 'x' ? b.x + d : b.x
    const nz = axis === 'z' ? b.z + d : b.z
    if (!boxHits(q, s, nx, b.y, nz) && (!b.grounded || canStand(q, r, nx, b.y, nz))) {
      b.x = nx
      b.z = nz
      continue
    }
    if (!b.grounded) continue
    // Auto-step onto a higher block.
    for (let k = 1; k <= Math.ceil(r.step); k++) {
      const ny = Math.floor(b.y + EPS) + k
      if (ny - b.y > r.step + EPS) break
      if (!boxHits(q, s, b.x, ny, b.z) && !boxHits(q, s, nx, ny, nz) && canStand(q, r, nx, ny, nz)) {
        b.x = nx
        b.z = nz
        b.y = ny
        break
      }
    }
  }

  b.vy -= r.gravity * dt
  const ny = b.y + b.vy * dt
  const g = groundUnderBox(q, s, b.x, b.y, b.z, 256)
  if (b.vy <= 0 && g !== null && ny <= g) {
    b.y = g
    b.vy = 0
    b.grounded = true
  } else {
    b.y = ny
    b.grounded = false
  }
}

export type Gait = 'sneak' | 'walk' | 'run'

/** Speeds a little over a gait's own still count as that gait (easing in and out of it). */
const GAIT_MARGIN = 1.1

/** Which gait a horizontal speed looks like: creeping (and standing) is `sneak`. */
export function gaitOf(speed: number, sneakSpeed: number, walkSpeed: number): Gait {
  if (speed <= sneakSpeed * GAIT_MARGIN) return 'sneak'
  return speed <= walkSpeed * GAIT_MARGIN ? 'walk' : 'run'
}

export interface Velocity {
  vx: number
  vz: number
}

export interface SteerRules {
  /** How quickly speed rises towards the wanted one (1/s). */
  acceleration: number
  /** How quickly it falls (1/s): letting go, slowing down to arrive. */
  deceleration: number
  /** How fast the heading may turn (rad/s): new directions are arcs, not stops. */
  turnRate: number
}

/**
 * Bend the velocity towards the wanted one (tx, tz). Speed eases in and out on its own; the heading
 * turns at most `turnRate` per second, and while it still points away from where one wants to go
 * (a U-turn) the speed drops, so turning back is tight instead of a wide loop. Mutates `v`.
 */
export function steer(v: Velocity, tx: number, tz: number, r: SteerRules, dt: number): void {
  const s = Math.hypot(v.vx, v.vz)
  const want = Math.hypot(tx, tz)
  let ns = s + (want - s) * Math.min(1, (want > s ? r.acceleration : r.deceleration) * dt)
  if (ns < 1e-3) {
    v.vx = v.vz = 0
    return
  }
  if (want < 1e-6 || s < 1e-3) {
    // stopping keeps the heading; starting takes the wanted one at once
    const k = want < 1e-6 ? ns / s : ns / want
    v.vx = (want < 1e-6 ? v.vx : tx) * k
    v.vz = (want < 1e-6 ? v.vz : tz) * k
    return
  }
  const a = Math.atan2(v.vx, v.vz)
  let diff = Math.atan2(Math.sin(Math.atan2(tx, tz) - a), Math.cos(Math.atan2(tx, tz) - a))
  const max = r.turnRate * dt
  const left = Math.abs(diff) - max
  if (left > 0) diff = Math.sign(diff) * max
  // still facing more than sideways away: brake while turning
  if (left > Math.PI / 2) ns = Math.min(ns, s * (1 - Math.min(1, r.deceleration * dt)))
  const h = a + diff
  v.vx = Math.sin(h) * ns
  v.vz = Math.cos(h) * ns
}
