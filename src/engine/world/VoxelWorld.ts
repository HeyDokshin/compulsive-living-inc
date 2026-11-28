import { AIR, BlockPalette } from './BlockPalette'

export const CHUNK_SIZE = 16

export interface Chunk {
  cx: number
  cz: number
  /** Index: x + z * 16 + y * 256 (local coords). */
  data: Uint16Array
  /** Bumped on every change; lets the renderer drop stale meshes. */
  version: number
}

/**
 * A bounded island of voxel columns: `chunksX × chunksZ` chunks of 16×height×16.
 * Pure data — no three.js — so it is usable from tests, workers and future servers.
 */
export class VoxelWorld {
  readonly palette: BlockPalette
  chunksX = 0
  chunksZ = 0
  height = 0
  chunks: Chunk[] = []
  /** Chunk indices whose meshes need rebuilding. */
  readonly dirty = new Set<number>()
  /** Blocks from a chunk's edge that still change how its neighbours look (rounded meshing reads them). */
  neighbourReach = 1
  /**
   * World coordinates of the first cell (0 for the island). Rooms sit far off the island, so things
   * in a room never share cells with things outside. Chunks keep local indices.
   */
  originX = 0
  originZ = 0

  constructor(palette = new BlockPalette()) {
    this.palette = palette
  }

  /** Move the world's first cell to (x, z) in world coordinates. */
  setOrigin(x: number, z: number): void {
    this.originX = x
    this.originZ = z
  }

  get sizeX(): number {
    return this.chunksX * CHUNK_SIZE
  }
  get sizeZ(): number {
    return this.chunksZ * CHUNK_SIZE
  }

  /** (Re)create an empty world. */
  reset(chunksX: number, chunksZ: number, height: number): void {
    this.chunksX = chunksX
    this.chunksZ = chunksZ
    this.height = height
    this.chunks = []
    for (let cz = 0; cz < chunksZ; cz++) {
      for (let cx = 0; cx < chunksX; cx++) {
        this.chunks.push({ cx, cz, data: new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * height), version: 0 })
      }
    }
    this.markAllDirty()
  }

  /** World coordinates. */
  inBounds(x: number, y: number, z: number): boolean {
    return this.inLocal(x - this.originX, y, z - this.originZ)
  }

  private inLocal(x: number, y: number, z: number): boolean {
    return x >= 0 && z >= 0 && y >= 0 && x < this.sizeX && z < this.sizeZ && y < this.height
  }

  chunkIndex(cx: number, cz: number): number {
    return cx + cz * this.chunksX
  }

  chunkAt(cx: number, cz: number): Chunk | undefined {
    if (cx < 0 || cz < 0 || cx >= this.chunksX || cz >= this.chunksZ) return undefined
    return this.chunks[this.chunkIndex(cx, cz)]
  }

  /** Block number at world coords (0 = air, also outside the world). */
  get(x: number, y: number, z: number): number {
    return this.getLocal(x - this.originX, y, z - this.originZ)
  }

  private getLocal(x: number, y: number, z: number): number {
    if (!this.inLocal(x, y, z)) return 0
    const c = this.chunks[(x >> 4) + (z >> 4) * this.chunksX]!
    return c.data[(x & 15) + (z & 15) * 16 + y * 256]!
  }

  /** Set a block number. Returns false if out of bounds or unchanged. */
  set(wx: number, y: number, wz: number, num: number): boolean {
    const x = wx - this.originX
    const z = wz - this.originZ
    if (!this.inLocal(x, y, z)) return false
    const cx = x >> 4
    const cz = z >> 4
    const ci = cx + cz * this.chunksX
    const c = this.chunks[ci]!
    const i = (x & 15) + (z & 15) * 16 + y * 256
    if (c.data[i] === num) return false
    c.data[i] = num
    c.version++
    this.dirty.add(ci)
    // Faces, ambient occlusion and the rounded surface of neighbours (which reads 2 blocks into this
    // chunk) depend on this block.
    const lx = x & 15
    const lz = z & 15
    const reach = this.neighbourReach
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue
        if ((dx === -1 && lx >= reach) || (dx === 1 && lx < 16 - reach) || (dz === -1 && lz >= reach) || (dz === 1 && lz < 16 - reach)) continue
        const n = this.chunkAt(cx + dx, cz + dz)
        if (n) this.dirty.add(this.chunkIndex(n.cx, n.cz))
      }
    }
    return true
  }

  getId(x: number, y: number, z: number): string {
    return this.palette.id(this.get(x, y, z))
  }

  setId(x: number, y: number, z: number, id: string): boolean {
    return this.set(x, y, z, id === AIR ? 0 : this.palette.num(id))
  }

  /** Fill a vertical run of a column [y0, y1) — fast path for generators (no neighbour marking). */
  fillColumn(wx: number, wz: number, y0: number, y1: number, num: number): void {
    const x = wx - this.originX
    const z = wz - this.originZ
    if (x < 0 || z < 0 || x >= this.sizeX || z >= this.sizeZ) return
    const c = this.chunks[(x >> 4) + (z >> 4) * this.chunksX]!
    const base = (x & 15) + (z & 15) * 16
    for (let y = Math.max(0, y0); y < Math.min(this.height, y1); y++) c.data[base + y * 256] = num
    c.version++
  }

  /** Y of the first empty cell above the highest block matching `test` (default: any non-air). */
  surfaceY(x: number, z: number, test: (num: number) => boolean = (n) => n !== 0): number {
    for (let y = this.height - 1; y >= 0; y--) if (test(this.get(x, y, z))) return y + 1
    return 0
  }

  markAllDirty(): void {
    for (let i = 0; i < this.chunks.length; i++) this.dirty.add(i)
  }

  /**
   * Copy a chunk plus a 1-block border from neighbour chunks into a padded volume for the mesher.
   * Beyond the world's X/Z edges the edge column is repeated, so the island has no visible
   * outer walls and blends into the endless sea around it. Above/below the world is air.
   * Layout: (x+1) + (z+1)*18 + (y+1)*18*18, size 18 × (height+2) × 18.
   */
  paddedVolume(ci: number, out?: Uint16Array, pad = 1): Uint16Array {
    const P = CHUNK_SIZE + 2 * pad
    const H = this.height + 2
    const vol = out && out.length === P * P * H ? out.fill(0) : new Uint16Array(P * P * H)
    const c = this.chunks[ci]!
    const ox = c.cx * 16
    const oz = c.cz * 16
    for (let y = 0; y < this.height; y++) {
      for (let z = -pad; z < 16 + pad; z++) {
        for (let x = -pad; x < 16 + pad; x++) {
          const inside = x >= 0 && x < 16 && z >= 0 && z < 16
          const v = inside ? c.data[x + z * 16 + y * 256]! : this.getLocal(clamp(ox + x, 0, this.sizeX - 1), y, clamp(oz + z, 0, this.sizeZ - 1))
          if (v) vol[x + pad + (z + pad) * P + (y + 1) * P * P] = v
        }
      }
    }
    return vol
  }
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
