/**
 * Round, plush meshes from voxel models (pure, no three.js). The model is sampled on a finer grid,
 * blurred and turned into a smooth surface (surface nets), so blocky parts become soft rounded
 * shapes while keeping the colors painted in voxels. Used for characters (`round` rigs).
 */
import { voxelAt, type GeometryData, type VoxelModel } from './voxelModel'

export interface SmoothOptions {
  /** Fine samples per voxel along each axis (2…4). More = smoother, more triangles. */
  subdiv: number
  /** Blur passes (each a 3-sample box per axis): how round corners get. */
  smooth: number
  /** Surface level of the blurred density (lower = fuller, keeps thin parts like ears). */
  iso: number
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
  let d = new Float32Array(nx * ny * nz)
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const vx = Math.floor(x / k) - pad
        const vy = Math.floor(y / k) - pad
        const vz = Math.floor(z / k) - pad
        if (voxelAt(m, vx, vy, vz)) d[idx(x, y, z)] = 1
      }
  // separable box blur
  let tmp = new Float32Array(d.length)
  const strides = [1, nx, nx * ny]
  const dims = [nx, ny, nz]
  for (let pass = 0; pass < o.smooth; pass++) {
    for (let axis = 0; axis < 3; axis++) {
      const s = strides[axis]!
      const n = dims[axis]!
      for (let z = 0; z < nz; z++)
        for (let y = 0; y < ny; y++)
          for (let x = 0; x < nx; x++) {
            const i = idx(x, y, z)
            const c = axis === 0 ? x : axis === 1 ? y : z
            const a = c > 0 ? d[i - s]! : 0
            const b = c < n - 1 ? d[i + s]! : 0
            tmp[i] = (a + d[i]! + b) / 3
          }
      const t = d
      d = tmp
      tmp = t
    }
  }

  const iso = o.iso
  const inside = (i: number) => d[i]! > iso
  // position of a fine sample in voxel units (relative to the model's min corner)
  const sx = (x: number) => (x + 0.5) / k - pad
  // density gradient at a sample (central differences)
  const grad = (x: number, y: number, z: number, out: number[]) => {
    const g = (xx: number, yy: number, zz: number) => (xx < 0 || yy < 0 || zz < 0 || xx >= nx || yy >= ny || zz >= nz ? 0 : d[idx(xx, yy, zz)]!)
    out[0] = g(x + 1, y, z) - g(x - 1, y, z)
    out[1] = g(x, y + 1, z) - g(x, y - 1, z)
    out[2] = g(x, y, z + 1) - g(x, y, z - 1)
  }

  const out: SmoothGeometry = { position: [], normal: [], colorIndex: [], index: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
  // one vertex per cell (8 samples) the surface passes through
  const cx = nx - 1
  const cy = ny - 1
  const cz = nz - 1
  const vert = new Int32Array(cx * cy * cz).fill(-1)
  const cell = (x: number, y: number, z: number) => x + cx * (y + cy * z)
  const corner = [0, 0, 0]
  const gsum = [0, 0, 0]
  const gtmp = [0, 0, 0]
  for (let z = 0; z < cz; z++)
    for (let y = 0; y < cy; y++)
      for (let x = 0; x < cx; x++) {
        let mask = 0
        for (let c = 0; c < 8; c++) if (inside(idx(x + (c & 1), y + ((c >> 1) & 1), z + ((c >> 2) & 1)))) mask |= 1 << c
        if (mask === 0 || mask === 255) continue
        // average of the edge crossings
        let px = 0
        let py = 0
        let pz = 0
        let count = 0
        for (let a = 0; a < 8; a++) {
          for (let axis = 0; axis < 3; axis++) {
            const b = a | (1 << axis)
            if (b === a) continue
            const ia = ((mask >> a) & 1) === 1
            const ib = ((mask >> b) & 1) === 1
            if (ia === ib) continue
            const da = d[idx(x + (a & 1), y + ((a >> 1) & 1), z + ((a >> 2) & 1))]!
            const db = d[idx(x + (b & 1), y + ((b >> 1) & 1), z + ((b >> 2) & 1))]!
            const t = (iso - da) / (db - da)
            corner[0] = (a & 1) + (axis === 0 ? t : 0)
            corner[1] = ((a >> 1) & 1) + (axis === 1 ? t : 0)
            corner[2] = ((a >> 2) & 1) + (axis === 2 ? t : 0)
            px += corner[0]!
            py += corner[1]!
            pz += corner[2]!
            count++
          }
        }
        px /= count
        py /= count
        pz /= count
        // smooth normal: gradient blended over the cell's corners
        gsum[0] = gsum[1] = gsum[2] = 0
        for (let c = 0; c < 8; c++) {
          const ox = c & 1
          const oy = (c >> 1) & 1
          const oz = (c >> 2) & 1
          const w = (ox ? px : 1 - px) * (oy ? py : 1 - py) * (oz ? pz : 1 - pz)
          grad(x + ox, y + oy, z + oz, gtmp)
          gsum[0] += gtmp[0]! * w
          gsum[1] += gtmp[1]! * w
          gsum[2] += gtmp[2]! * w
        }
        const gl = Math.hypot(gsum[0]!, gsum[1]!, gsum[2]!) || 1
        const vx = sx(x + px)
        const vy = sx(y + py)
        const vz = sx(z + pz)
        vert[cell(x, y, z)] = out.position.length / 3
        out.position.push(vx - pivot[0], vy - pivot[1], vz - pivot[2])
        out.normal.push(-gsum[0]! / gl, -gsum[1]! / gl, -gsum[2]! / gl)
        out.colorIndex.push(nearestColor(m, vx, vy, vz))
        const p = out.position.length - 3
        for (let i = 0; i < 3; i++) {
          out.min[i] = Math.min(out.min[i]!, out.position[p + i]!)
          out.max[i] = Math.max(out.max[i]!, out.position[p + i]!)
        }
      }

  // a quad around every sample edge the surface crosses, facing outwards
  const N = out.normal
  const P = out.position
  const quad = (a: number, b: number, c: number, e: number) => {
    if (a < 0 || b < 0 || c < 0 || e < 0) return
    // outward = along the vertex normals
    const ux = P[b * 3]! - P[a * 3]!
    const uy = P[b * 3 + 1]! - P[a * 3 + 1]!
    const uz = P[b * 3 + 2]! - P[a * 3 + 2]!
    const wx = P[c * 3]! - P[a * 3]!
    const wy = P[c * 3 + 1]! - P[a * 3 + 1]!
    const wz = P[c * 3 + 2]! - P[a * 3 + 2]!
    const fx = uy * wz - uz * wy
    const fy = uz * wx - ux * wz
    const fz = ux * wy - uy * wx
    const nx2 = N[a * 3]! + N[b * 3]! + N[c * 3]! + N[e * 3]!
    const ny2 = N[a * 3 + 1]! + N[b * 3 + 1]! + N[c * 3 + 1]! + N[e * 3 + 1]!
    const nz2 = N[a * 3 + 2]! + N[b * 3 + 2]! + N[c * 3 + 2]! + N[e * 3 + 2]!
    if (fx * nx2 + fy * ny2 + fz * nz2 >= 0) out.index.push(a, b, c, a, c, e)
    else out.index.push(a, c, b, a, e, c)
  }
  for (let z = 1; z < cz; z++)
    for (let y = 1; y < cy; y++)
      for (let x = 1; x < cx; x++) {
        const here = inside(idx(x, y, z))
        // edge along x from sample (x,y,z) to (x+1,y,z): cells (x, y-1..y, z-1..z)
        if (x < cx && here !== inside(idx(x + 1, y, z))) quad(vert[cell(x, y - 1, z - 1)]!, vert[cell(x, y, z - 1)]!, vert[cell(x, y, z)]!, vert[cell(x, y - 1, z)]!)
        if (y < cy && here !== inside(idx(x, y + 1, z))) quad(vert[cell(x - 1, y, z - 1)]!, vert[cell(x, y, z - 1)]!, vert[cell(x, y, z)]!, vert[cell(x - 1, y, z)]!)
        if (z < cz && here !== inside(idx(x, y, z + 1))) quad(vert[cell(x - 1, y - 1, z)]!, vert[cell(x, y - 1, z)]!, vert[cell(x, y, z)]!, vert[cell(x - 1, y, z)]!)
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
