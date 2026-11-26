/**
 * The island drawn soft and rounded: the voxels are sampled on a finer grid, blurred (more across
 * than up, so plateaus stay flat while their outlines turn into squircles and their edges into soft
 * lips) and turned into a surface (surface nets). Colors come from the blocks (top and side color),
 * creases get a little shade, water is its own smooth surface. Pure: runs in a worker and in tests.
 *
 * The chunk owns the surface between its own samples; the volume carries `pad` blocks of the
 * neighbours on each side, enough for the blur and the normals, so chunks meet without seams.
 */
import { boxBlur, surfaceNets } from '../../models/surfaceNets'
import { LIQUID_INSET, tintAt, type BlockTable, type MeshBuffers, type MeshOutput, type TintParams } from './mesher'

export interface RoundParams {
  /** Fine samples per block (odd: every block keeps its middle). */
  subdiv: number
  /** Blur passes across (x, z): how round outlines get. */
  smoothAcross: number
  /** Blur passes up and down: how soft edges get. */
  smoothUp: number
  /** A block's middle stays at least this dense, so single blocks never vanish. */
  keep: number
  /** Shade in creases (0…1). */
  ao: number
}

export interface RoundInput {
  /** Volume padded by `pad` blocks across and 1 block up and down: (sx+2p) × (sy+2) × (sz+2p). */
  vol: Uint16Array
  sx: number
  sy: number
  sz: number
  pad: number
  table: BlockTable
  round: RoundParams
  tint?: TintParams
}

/** A fresh empty array (buffers are transferred out of the worker: never share one). */
const none = () => new Float32Array(0)

export function meshChunkRound(input: RoundInput): MeshOutput {
  const { vol, sx, sy, sz, pad, table, round: r } = input
  const k = Math.max(1, Math.round(r.subdiv))
  const PX = sx + 2 * pad
  const PZ = sz + 2 * pad
  const PY = sy + 2
  const at = (x: number, y: number, z: number) => vol[x + z * PX + y * PX * PZ]! // padded coordinates
  const isLiquid = (b: number) => !!table.liquid && b < table.liquid.length && table.liquid[b] === 1
  const solidAt = (b: number) => b !== 0 && !isLiquid(b)

  // only the layers where something happens (a lot of the world is solid below and air above)
  let y0 = PY
  let y1 = -1
  for (let y = 0; y < PY; y++) {
    let solid = false
    let open = false
    for (let z = 0; z < PZ && !(solid && open); z++)
      for (let x = 0; x < PX; x++) {
        if (solidAt(at(x, y, z))) solid = true
        else open = true
      }
    if (solid && open) {
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
    if (isLiquidLayer(y)) {
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
  }
  function isLiquidLayer(y: number): boolean {
    for (let z = 0; z < PZ; z++) for (let x = 0; x < PX; x++) if (isLiquid(at(x, y, z))) return true
    return false
  }
  if (y1 < 0) return { opaque: emptyBuffers(), transparent: emptyBuffers() }
  y0 = Math.max(0, y0 - 1)
  y1 = Math.min(PY - 1, y1 + 1)
  const LY = y1 - y0 + 1

  const nx = PX * k
  const ny = LY * k
  const nz = PZ * k
  const n = nx * ny * nz
  const solid = new Float32Array(n)
  const water = new Float32Array(n)
  const idx = (x: number, y: number, z: number) => x + nx * (y + ny * z)
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const b = at(Math.floor(x / k), y0 + Math.floor(y / k), Math.floor(z / k))
        if (solidAt(b)) solid[idx(x, y, z)] = 1
        else if (isLiquid(b)) water[idx(x, y, z)] = 1
      }
  const tmp = new Float32Array(n)
  const sg = { d: solid, nx, ny, nz, iso: 0.5 }
  boxBlur(sg, [0, 2], r.smoothAcross, tmp)
  boxBlur(sg, [1], r.smoothUp, tmp)
  // single blocks keep their middle
  if (k % 2 === 1 && r.keep > 0) {
    const h = (k - 1) / 2
    for (let z = 0; z < PZ; z++)
      for (let y = 0; y < LY; y++)
        for (let x = 0; x < PX; x++) {
          if (!solidAt(at(x, y0 + y, z))) continue
          const i = idx(x * k + h, y * k + h, z * k + h)
          if (solid[i]! < r.keep) solid[i] = r.keep
        }
  }
  // how close real water is (to keep the surface near it only)
  const wet = new Float32Array(water)
  boxBlur({ d: wet, nx, ny, nz }, [0, 2], r.smoothAcross + 2, tmp)
  // water is drawn where it meets air: its field holds the ground too, so no faces hide in the bed
  for (let i = 0; i < n; i++) water[i] = Math.max(water[i]!, solid[i]! > 0.5 ? 1 : 0)
  const wg = { d: water, nx, ny, nz, iso: 0.5 }
  boxBlur(wg, [0, 2], r.smoothAcross, tmp)

  // samples this chunk owns (across): the ones inside its own blocks
  const lo = pad * k
  const hiX = (pad + sx) * k
  const hiZ = (pad + sz) * k
  const owned = (x: number, z: number) => x >= lo && x < hiX && z >= lo && z < hiZ

  const ground = surfaceNets(sg, (x, _y, z) => owned(x, z))
  const waterNets = surfaceNets(wg, (x, y, z, axis) => {
    if (!owned(x, z)) return false
    // the inside sample of this edge must be water, not deep in the ground; near the bank the water
    // runs on under the rounded ground, so the ground's smooth outline is the shore
    const a = idx(x, y, z)
    const b = idx(x + (axis === 0 ? 1 : 0), y + (axis === 1 ? 1 : 0), z + (axis === 2 ? 1 : 0))
    const inner = water[a]! > water[b]! ? a : b
    return solid[inner]! < 0.97 && wet[inner]! > 0.02
  })

  const tint = input.tint && input.tint.strength > 0 && table.tint ? input.tint : undefined
  const toLocal = (f: number, padded: number) => (f + 0.5) / k - padded
  /** Nearest block of `pred` around a point in padded block coordinates. */
  const nearest = (px: number, py: number, pz: number, pred: (b: number) => boolean): number => {
    const bx = Math.floor(px)
    const by = Math.floor(py)
    const bz = Math.floor(pz)
    let best = 0
    let bestD = Infinity
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = bx + dx
          const y = by + dy
          const z = bz + dz
          if (x < 0 || z < 0 || y < 0 || x >= PX || z >= PZ || y >= PY) continue
          const b = at(x, y, z)
          if (!pred(b)) continue
          const qx = Math.max(x - px, 0, px - (x + 1))
          const qy = Math.max(y - py, 0, py - (y + 1))
          const qz = Math.max(z - pz, 0, pz - (z + 1))
          const dd = qx * qx + qy * qy + qz * qz
          if (dd < bestD) {
            bestD = dd
            best = b
          }
        }
    return best
  }
  const colorOf = (arr: Float32Array | undefined, b: number, c: number) => (arr && b * 3 + c < arr.length ? arr[b * 3 + c]! : 0.8)

  const build = (nets: ReturnType<typeof surfaceNets>, liquid: boolean): MeshBuffers => {
    const count = nets.position.length / 3
    const position = new Float32Array(count * 3)
    const normal = new Float32Array(nets.normal)
    const color = new Float32Array(count * 3)
    const detail = new Float32Array(count)
    for (let v = 0; v < count; v++) {
      const fx = nets.position[v * 3]!
      const fy = nets.position[v * 3 + 1]!
      const fz = nets.position[v * 3 + 2]!
      // padded block coordinates of the vertex
      const px = (fx + 0.5) / k
      const py = (fy + 0.5) / k + y0
      const pz = (fz + 0.5) / k
      const ny_ = normal[v * 3 + 1]!
      let y = toLocal(fy, 0) + y0 - 1
      if (liquid && ny_ > 0.5) y -= LIQUID_INSET * ny_
      position[v * 3] = px - pad
      position[v * 3 + 1] = y
      position[v * 3 + 2] = pz - pad
      if (liquid) {
        color[v * 3] = color[v * 3 + 1] = color[v * 3 + 2] = 1
        detail[v] = -1
        continue
      }
      const b = nearest(px, py, pz, solidAt)
      // top color on what faces up, side color on walls, blended over the soft lip
      const t = Math.min(1, Math.max(0, (ny_ - 0.35) / 0.4))
      const top = t * t * (3 - 2 * t)
      let cr = colorOf(table.sideColor, b, 0) * (1 - top) + colorOf(table.topColor, b, 0) * top
      let cg = colorOf(table.sideColor, b, 1) * (1 - top) + colorOf(table.topColor, b, 1) * top
      let cb = colorOf(table.sideColor, b, 2) * (1 - top) + colorOf(table.topColor, b, 2) * top
      if (tint && top > 0 && b < table.tint!.length && table.tint![b] === 1) {
        const [tr, tg, tb] = tintAt(tint, tint.origin[0] + px - pad, tint.origin[1] + pz - pad)
        cr *= 1 + (tr - 1) * top
        cg *= 1 + (tg - 1) * top
        cb *= 1 + (tb - 1) * top
      }
      // crease shade: how much ground there is just outside the surface
      const ox = Math.round(fx + normal[v * 3]! * k * 0.6)
      const oy = Math.round(fy + ny_ * k * 0.6)
      const oz = Math.round(fz + normal[v * 3 + 2]! * k * 0.6)
      const around = ox >= 0 && oy >= 0 && oz >= 0 && ox < nx && oy < ny && oz < nz ? solid[idx(ox, oy, oz)]! : 0
      const shade = 1 - r.ao * Math.min(1, Math.max(0, (around - 0.08) * 2.2))
      color[v * 3] = cr * shade
      color[v * 3 + 1] = cg * shade
      color[v * 3 + 2] = cb * shade
      const slots = top >= 0.5 ? table.detailTop : table.detailSide
      detail[v] = slots && b < slots.length ? slots[b]! : -1
    }
    return { position, normal, uv: none(), tile: none(), color, detail, index: new Uint32Array(nets.index) }
  }
  return { opaque: build(ground, false), transparent: build(waterNets, true) }
}

function emptyBuffers(): MeshBuffers {
  return { position: none(), normal: none(), uv: none(), tile: none(), color: none(), detail: none(), index: new Uint32Array(0) }
}
