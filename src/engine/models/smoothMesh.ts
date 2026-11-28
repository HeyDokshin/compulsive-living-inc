/**
 * Round, plush meshes from voxel models (pure, no three.js). The model is sampled on a finer grid,
 * blurred and turned into a smooth surface (surface nets), so blocky parts become soft rounded
 * shapes while keeping the colors painted in voxels. Used for characters (`round` rigs).
 */
import { boxBlur, surfaceNets } from './surfaceNets'
import { voxelAt, type GeometryData, type VoxelModel } from './voxelModel'

export interface SmoothOptions {
  /** Fine samples per voxel along each axis (2…4). More = smoother, more triangles. */
  subdiv: number
  /** Blur passes (each a 3-sample box per axis): how round corners get. */
  smooth: number
  /** Surface level of the blurred density (lower = fuller, keeps thin parts like ears). */
  iso: number
  /** With an odd `subdiv`: each voxel's middle stays at least this dense, so nothing thin vanishes (0 = off). */
  keep?: number
}

export interface SmoothGeometry extends GeometryData {
  /** Bounds of the surface (voxel units, relative to the pivot). */
  min: [number, number, number]
  max: [number, number, number]
}

/** Build the smooth surface of a voxel model, positions relative to `pivot` (voxel units). */
export function buildSmoothGeometry(m: VoxelModel, pivot: [number, number, number], o: SmoothOptions): SmoothGeometry {
  const k = Math.max(1, Math.round(o.subdiv))
  const pad = 1
  const nx = (m.size[0] + pad * 2) * k
  const ny = (m.size[1] + pad * 2) * k
  const nz = (m.size[2] + pad * 2) * k
  const idx = (x: number, y: number, z: number) => x + nx * (y + ny * z)
  // occupancy at fine sample centers
  const d = new Float32Array(nx * ny * nz)
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const vx = Math.floor(x / k) - pad
        const vy = Math.floor(y / k) - pad
        const vz = Math.floor(z / k) - pad
        if (voxelAt(m, vx, vy, vz)) d[idx(x, y, z)] = 1
      }
  const grid = { d, nx, ny, nz, iso: o.iso }
  boxBlur(grid, [0, 1, 2], o.smooth)
  // thin parts (a stem, a single block) keep at least their middle
  if (o.keep && k % 2 === 1) {
    const h = (k - 1) / 2
    for (let vz = 0; vz < m.size[2]; vz++)
      for (let vy = 0; vy < m.size[1]; vy++)
        for (let vx = 0; vx < m.size[0]; vx++) {
          if (!voxelAt(m, vx, vy, vz)) continue
          const i = idx((vx + pad) * k + h, (vy + pad) * k + h, (vz + pad) * k + h)
          if (d[i]! < o.keep) d[i] = o.keep
        }
  }
  const nets = surfaceNets(grid)
  const out: SmoothGeometry = {
    position: [],
    normal: nets.normal,
    colorIndex: [],
    index: nets.index,
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  }
  for (let i = 0; i < nets.position.length; i += 3) {
    // sample i sits at the center of fine cell i: (i + 0.5) / k voxels from the padded corner
    const vx = (nets.position[i]! + 0.5) / k - pad
    const vy = (nets.position[i + 1]! + 0.5) / k - pad
    const vz = (nets.position[i + 2]! + 0.5) / k - pad
    const p = [vx - pivot[0], vy - pivot[1], vz - pivot[2]] as const
    out.position.push(p[0], p[1], p[2])
    out.colorIndex.push(nearestColor(m, vx, vy, vz))
    for (let a = 0; a < 3; a++) {
      out.min[a] = Math.min(out.min[a]!, p[a]!)
      out.max[a] = Math.max(out.max[a]!, p[a]!)
    }
  }
  return out
}

/** Color index of the painted voxel nearest to a point (voxel units). */
function nearestColor(m: VoxelModel, x: number, y: number, z: number): number {
  const bx = Math.floor(x)
  const by = Math.floor(y)
  const bz = Math.floor(z)
  let best = 0
  let bestD = Infinity
  for (let dz = -1; dz <= 1; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const c = voxelAt(m, bx + dx, by + dy, bz + dz)
        if (!c) continue
        // distance to the voxel's box (0 inside it)
        const qx = Math.max(bx + dx - x, 0, x - (bx + dx + 1))
        const qy = Math.max(by + dy - y, 0, y - (by + dy + 1))
        const qz = Math.max(bz + dz - z, 0, z - (bz + dz + 1))
        const dd = qx * qx + qy * qy + qz * qz
        if (dd < bestD) {
          bestD = dd
          best = c
        }
      }
  return best || 1
}
