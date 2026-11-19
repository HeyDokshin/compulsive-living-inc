/** Voxel ray casting for mouse picking (pure). */

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface VoxelHit {
  x: number
  y: number
  z: number
  /** Normal of the face the ray entered through. */
  face: [number, number, number]
  /** Distance along the ray. */
  t: number
}

/** Amanatides–Woo grid traversal: first cell where `hit` is true, or null. */
export function raycastVoxels(o: Vec3, d: Vec3, hit: (x: number, y: number, z: number) => boolean, maxDist: number): VoxelHit | null {
  let x = Math.floor(o.x)
  let y = Math.floor(o.y)
  let z = Math.floor(o.z)
  const stepX = Math.sign(d.x)
  const stepY = Math.sign(d.y)
  const stepZ = Math.sign(d.z)
  const tDeltaX = stepX ? Math.abs(1 / d.x) : Infinity
  const tDeltaY = stepY ? Math.abs(1 / d.y) : Infinity
  const tDeltaZ = stepZ ? Math.abs(1 / d.z) : Infinity
  const frac = (v: number, s: number) => (s > 0 ? Math.floor(v) + 1 - v : v - Math.floor(v))
  let tMaxX = stepX ? frac(o.x, stepX) * tDeltaX : Infinity
  let tMaxY = stepY ? frac(o.y, stepY) * tDeltaY : Infinity
  let tMaxZ = stepZ ? frac(o.z, stepZ) * tDeltaZ : Infinity
  let face: [number, number, number] = [0, 0, 0]
  let t = 0
  while (t <= maxDist) {
    if (hit(x, y, z)) return { x, y, z, face, t }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX
      t = tMaxX
      tMaxX += tDeltaX
      face = [-stepX, 0, 0]
    } else if (tMaxY < tMaxZ) {
      y += stepY
      t = tMaxY
      tMaxY += tDeltaY
      face = [0, -stepY, 0]
    } else {
      z += stepZ
      t = tMaxZ
      tMaxZ += tDeltaZ
      face = [0, 0, -stepZ]
    }
  }
  return null
}

export interface Curvature {
  /** uCurve: y drops by k·d² where d is the distance along `forward` from `center`. */
  k: number
  center: Vec3
  forward: { x: number; z: number }
}

/**
 * Pick through a "rolling world": the screen shows each point lowered by k·d².
 * Raise the ray by the drop at the previous hit and cast again (converges in a few steps).
 */
export function pickCurved(o: Vec3, d: Vec3, hit: (x: number, y: number, z: number) => boolean, maxDist: number, curve?: Curvature): VoxelHit | null {
  let h = raycastVoxels(o, d, hit, maxDist)
  if (!curve || curve.k <= 0 || !h) return h
  for (let i = 0; i < 4 && h; i++) {
    const px = o.x + d.x * h.t
    const pz = o.z + d.z * h.t
    const dd = (px - curve.center.x) * curve.forward.x + (pz - curve.center.z) * curve.forward.z
    const lift = curve.k * dd * dd
    const next = raycastVoxels({ x: o.x, y: o.y + lift, z: o.z }, d, hit, maxDist)
    if (!next || (next.x === h.x && next.y === h.y && next.z === h.z)) return next ?? h
    h = next
  }
  return h
}
