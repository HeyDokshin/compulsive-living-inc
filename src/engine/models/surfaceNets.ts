/**
 * Surface nets over a density grid (pure, no three.js): one vertex per grid cell the surface passes
 * through (the average of its edge crossings), quads around every crossed edge, smooth normals
 * from the density gradient. Used for round characters and the rounded island.
 */

export interface NetsGrid {
  /** Density per sample, index x + nx * (y + ny * z). */
  d: Float32Array<ArrayBufferLike>
  nx: number
  ny: number
  nz: number
  /** Inside where density > iso. */
  iso: number
}

export interface NetsResult {
  /** Vertex positions in sample coordinates (sample i sits at i). */
  position: number[]
  /** Unit normals pointing out of the solid. */
  normal: number[]
  index: number[]
}

/**
 * Build the surface. `keepQuad(x, y, z, axis)` may drop the quad around the edge from sample
 * (x, y, z) along `axis` (e.g. water quads that lie against the ground).
 */
export function surfaceNets(g: NetsGrid, keepQuad?: (x: number, y: number, z: number, axis: number) => boolean): NetsResult {
  const { d, nx, ny, nz, iso } = g
  const idx = (x: number, y: number, z: number) => x + nx * (y + ny * z)
  const inside = (i: number) => d[i]! > iso
  const sample = (x: number, y: number, z: number) => (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz ? 0 : d[idx(x, y, z)]!)
  const out: NetsResult = { position: [], normal: [], index: [] }
  const cx = nx - 1
  const cy = ny - 1
  const cz = nz - 1
  const vert = new Int32Array(Math.max(0, cx * cy * cz)).fill(-1)
  const cell = (x: number, y: number, z: number) => x + cx * (y + cy * z)
  const corner = new Float32Array(8)

  for (let z = 0; z < cz; z++)
    for (let y = 0; y < cy; y++)
      for (let x = 0; x < cx; x++) {
        let mask = 0
        for (let c = 0; c < 8; c++) {
          const v = d[idx(x + (c & 1), y + ((c >> 1) & 1), z + ((c >> 2) & 1))]!
          corner[c] = v
          if (v > iso) mask |= 1 << c
        }
        if (mask === 0 || mask === 255) continue
        let px = 0
        let py = 0
        let pz = 0
        let count = 0
        for (let a = 0; a < 8; a++) {
          for (let axis = 0; axis < 3; axis++) {
            const b = a | (1 << axis)
            if (b === a) continue
            if (((mask >> a) & 1) === ((mask >> b) & 1)) continue
            const t = (iso - corner[a]!) / (corner[b]! - corner[a]!)
            px += (a & 1) + (axis === 0 ? t : 0)
            py += ((a >> 1) & 1) + (axis === 1 ? t : 0)
            pz += ((a >> 2) & 1) + (axis === 2 ? t : 0)
            count++
          }
        }
        px /= count
        py /= count
        pz /= count
        // gradient blended over the cell's corners (trilinear weights of the vertex)
        let gx = 0
        let gy = 0
        let gz = 0
        for (let c = 0; c < 8; c++) {
          const ox = c & 1
          const oy = (c >> 1) & 1
          const oz = (c >> 2) & 1
          const w = (ox ? px : 1 - px) * (oy ? py : 1 - py) * (oz ? pz : 1 - pz)
          const sx = x + ox
          const sy = y + oy
          const sz = z + oz
          gx += (sample(sx + 1, sy, sz) - sample(sx - 1, sy, sz)) * w
          gy += (sample(sx, sy + 1, sz) - sample(sx, sy - 1, sz)) * w
          gz += (sample(sx, sy, sz + 1) - sample(sx, sy, sz - 1)) * w
        }
        const gl = Math.hypot(gx, gy, gz) || 1
        vert[cell(x, y, z)] = out.position.length / 3
        out.position.push(x + px, y + py, z + pz)
        out.normal.push(-gx / gl, -gy / gl, -gz / gl)
      }

  const P = out.position
  const N = out.normal
  const quad = (a: number, b: number, c: number, e: number) => {
    if (a < 0 || b < 0 || c < 0 || e < 0) return
    const ux = P[b * 3]! - P[a * 3]!
    const uy = P[b * 3 + 1]! - P[a * 3 + 1]!
    const uz = P[b * 3 + 2]! - P[a * 3 + 2]!
    const wx = P[c * 3]! - P[a * 3]!
    const wy = P[c * 3 + 1]! - P[a * 3 + 1]!
    const wz = P[c * 3 + 2]! - P[a * 3 + 2]!
    const fx = uy * wz - uz * wy
    const fy = uz * wx - ux * wz
    const fz = ux * wy - uy * wx
    const sx = N[a * 3]! + N[b * 3]! + N[c * 3]! + N[e * 3]!
    const sy = N[a * 3 + 1]! + N[b * 3 + 1]! + N[c * 3 + 1]! + N[e * 3 + 1]!
    const sz = N[a * 3 + 2]! + N[b * 3 + 2]! + N[c * 3 + 2]! + N[e * 3 + 2]!
    if (fx * sx + fy * sy + fz * sz >= 0) out.index.push(a, b, c, a, c, e)
    else out.index.push(a, c, b, a, e, c)
  }
  for (let z = 1; z < cz; z++)
    for (let y = 1; y < cy; y++)
      for (let x = 1; x < cx; x++) {
        const here = inside(idx(x, y, z))
        if (here !== inside(idx(x + 1, y, z)) && (!keepQuad || keepQuad(x, y, z, 0)))
          quad(vert[cell(x, y - 1, z - 1)]!, vert[cell(x, y, z - 1)]!, vert[cell(x, y, z)]!, vert[cell(x, y - 1, z)]!)
        if (here !== inside(idx(x, y + 1, z)) && (!keepQuad || keepQuad(x, y, z, 1)))
          quad(vert[cell(x - 1, y, z - 1)]!, vert[cell(x, y, z - 1)]!, vert[cell(x, y, z)]!, vert[cell(x - 1, y, z)]!)
        if (here !== inside(idx(x, y, z + 1)) && (!keepQuad || keepQuad(x, y, z, 2)))
          quad(vert[cell(x - 1, y - 1, z)]!, vert[cell(x, y - 1, z)]!, vert[cell(x, y, z)]!, vert[cell(x - 1, y, z)]!)
      }
  return out
}

/** Separable 3-sample box blur, `passes` times along each axis listed (0 = x, 1 = y, 2 = z). In place. */
export function boxBlur(
  g: Pick<NetsGrid, 'd' | 'nx' | 'ny' | 'nz'>,
  axes: readonly number[],
  passes: number,
  tmp: Float32Array = new Float32Array(g.d.length),
): void {
  const { nx, ny, nz } = g
  let src: Float32Array = g.d
  let dst: Float32Array = tmp
  const strides = [1, nx, nx * ny]
  const dims = [nx, ny, nz]
  let swaps = 0
  for (let pass = 0; pass < passes; pass++) {
    for (const axis of axes) {
      const s = strides[axis]!
      const n = dims[axis]!
      for (let z = 0; z < nz; z++)
        for (let y = 0; y < ny; y++)
          for (let x = 0; x < nx; x++) {
            const i = x + nx * (y + ny * z)
            const c = axis === 0 ? x : axis === 1 ? y : z
            // edges repeat the border sample (a solid floor stays solid at the volume's edge)
            const a = c > 0 ? src[i - s]! : src[i]!
            const b = c < n - 1 ? src[i + s]! : src[i]!
            dst[i] = (a + src[i]! + b) / 3
          }
      const t = src
      src = dst
      dst = t
      swaps++
    }
  }
  if (swaps % 2 === 1) g.d.set(src)
}
