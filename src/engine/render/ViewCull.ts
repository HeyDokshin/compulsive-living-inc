/**
 * What the isometric camera can see, worked out on the ground (pure math, tested). Knows about the
 * curved world: things far ahead sink towards the horizon, so a plain frustum test of their unbent
 * position would hide them too early when zoomed out.
 */
export interface CullView {
  /** Camera focus. */
  x: number
  y: number
  z: number
  /** Unit direction the camera looks in, on the ground. */
  fx: number
  fz: number
  /** Half size of the picture in world units. */
  halfW: number
  halfH: number
  /** Camera pitch (radians). */
  pitch: number
  curvature: number
  /** Extra world units around the picture (shadows of things just outside it). */
  margin: number
}

/** Can a ball at (x, y, z) with radius r show up in the picture? */
export function inView(v: CullView, x: number, y: number, z: number, r: number): boolean {
  const dx = x - v.x
  const dz = z - v.z
  const fwd = dx * v.fx + dz * v.fz
  const right = dx * -v.fz + dz * v.fx
  const pad = r + v.margin
  if (Math.abs(right) > v.halfW + pad) return false
  const drop = v.curvature * fwd * fwd
  const up = fwd * Math.sin(v.pitch) + (y - v.y - drop) * Math.cos(v.pitch)
  return Math.abs(up) <= v.halfH + pad
}

/** Half width of the square the shadow map must cover: what the picture shows on the ground, plus `margin`. */
export function shadowHalf(v: Pick<CullView, 'halfW' | 'halfH' | 'pitch'>, margin: number, max: number, step = 4): number {
  const need = Math.hypot(v.halfW, v.halfH / Math.sin(v.pitch)) + margin
  return Math.min(max, Math.ceil(need / step) * step)
}
