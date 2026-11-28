/**
 * Pure island generation steps (no plugin wiring), so they can be unit-tested.
 * Step order: shape (100) → rivers (200) → ponds (210) → surface (300) → voxels (400).
 */
import { z, type SurfaceRect, type WorldGenContext } from '@sdk'

export const Config = z.object({
  island: z
    .object({
      /** Share of the world covered by the island (0.4 of 128×128 ≈ 6 500 cells), same for every seed. */
      size: z.number().min(0.1).max(0.6).default(0.4).meta({ label: 'island size (share)', step: 0.01 }),
      coastNoise: z.number().min(0).max(1).default(0.2).meta({ label: 'coast noise', step: 0.01 }),
      coastScale: z.number().min(0.005).max(0.2).default(0.045).meta({ label: 'coast scale', step: 0.005 }),
      oceanDepth: z.number().int().min(1).max(10).default(3).meta({ label: 'ocean depth', step: 1 }),
    })
    .prefault({}),
  /** Land levels: the ground (level 1) and, where `count` is 2, raised land one block higher — never more. */
  tiers: z
    .object({
      count: z.number().int().min(1).max(2).default(2).meta({ step: 1 }),
      scale: z.number().min(0.005).max(0.2).default(0.03).meta({ step: 0.005 }),
      inlandBias: z.number().min(0).max(2).default(0.9).meta({ label: 'inland bias', step: 0.05 }),
      /** Raises or lowers all land: below 0 more of the island stays on the ground level. */
      offset: z.number().min(-1).max(1).default(-0.45).meta({ step: 0.05 }),
      smoothing: z.number().int().min(0).max(6).default(2).meta({ step: 1 }),
    })
    .prefault({}),
  rivers: z
    .object({
      count: z.number().int().min(0).max(6).default(2).meta({ step: 1 }),
      width: z.number().int().min(1).max(6).default(2).meta({ step: 1 }),
      meander: z.number().min(0).max(2).default(0.9).meta({ step: 0.05 }),
    })
    .prefault({}),
  ponds: z
    .object({
      count: z.number().int().min(0).max(10).default(2).meta({ step: 1 }),
      radius: z.number().min(1).max(8).default(2.6).meta({ step: 0.1 }),
    })
    .prefault({}),
  beachWidth: z.number().int().min(0).max(12).default(4).meta({ label: 'beach width', step: 1 }),
  /** Walkability: stairs between terraces and bridges over rivers until the whole island is reachable. */
  paths: z
    .object({
      /** Highest step a walker can climb or drop (must match the player's step height). */
      step: z.number().int().min(1).max(4).default(1).meta({ step: 1 }),
      maxBridge: z.number().int().min(2).max(16).default(8).meta({ label: 'max bridge length', step: 1 }),
      maxConnectors: z.number().int().min(0).max(100).default(40).meta({ label: 'max stairs+bridges', step: 1 }),
      /** Regions smaller than this (cells) are ignored when connecting. */
      minRegion: z.number().int().min(1).max(500).default(16).meta({ label: 'min region', step: 1 }),
    })
    .prefault({}),
  /** Decoration only: flat sea and sea bed drawn past the world edge so the island doesn't float in the sky. */
  seaBackdrop: z.boolean().default(true).meta({ label: 'sea backdrop' }),
  /** Grid cells per tile of the sea backdrop. */
  seaTile: z.number().int().min(4).max(128).default(32).meta({ label: 'sea tile', step: 1 }),
  blocks: z
    .object({
      grass: z.string().default('core:grass'),
      dirt: z.string().default('core:dirt'),
      sand: z.string().default('core:sand'),
      cliff: z.string().default('core:cliff'),
      stone: z.string().default('core:stone'),
      water: z.string().default('core:water'),
      planks: z.string().default('core:planks'),
    })
    .prefault({}),
})
export type Config = z.infer<typeof Config>

/** Data the terrain steps share through `ctx.data` (other plugins may read it too). */
export interface TerrainData {
  land: Uint8Array
  tier: Int8Array
  /** Inland water carved per column: 0 = none, 1 = river, 2 = pond (see `WATER_RIVER`, `WATER_POND`). */
  river: Uint8Array
  oceanDistance: Int16Array
  /** Share of the world that is land after shaping. */
  landFraction: number
  /** Bridge deck height per column (0 = none). Filled by `connect`. */
  bridge?: Int16Array
  /** 1 where `connect` built stairs. */
  stairs?: Uint8Array
  /** Walkable regions left after connecting (1 = whole island reachable). */
  regions?: number
  stairsBuilt?: number
  bridgesBuilt?: number
}

export const td = (ctx: WorldGenContext) => ctx.data.terrain as TerrainData

// ---------------------------------------------------------------------------------------------

/** Ring between `inner` and `outer` units around [0, sx] × [0, sz], split into `cell`-sized quads. */
export function seaRing(sx: number, sz: number, inner: number, outer: number, cell: number): SurfaceRect[] {
  const a = -outer
  const b = -inner
  return [
    [a, a, sx + outer, b, cell],
    [a, sz + inner, sx + outer, sz + outer, cell],
    [a, b, b, sz + inner, cell],
    [sx + inner, b, sx + outer, sz + inner, cell],
  ]
}

/** Cut rects into tiles of at most `cells` grid cells a side (drawn and hidden one by one). */
export function tileRects(rects: readonly SurfaceRect[], cells: number): SurfaceRect[] {
  const out: SurfaceRect[] = []
  for (const [x0, z0, x1, z1, cell = 1] of rects) {
    const size = cell * cells
    for (let z = z0; z < z1; z += size) for (let x = x0; x < x1; x += size) out.push([x, z, Math.min(x1, x + size), Math.min(z1, z + size), cell])
  }
  return out
}

/** Height of the sea bed surface outside the world (matches the in-world floor near the edge). */
export function seaBedY(sea: number, cfg: Config): number {
  return Math.max(1, sea - cfg.island.oceanDepth - 1)
}

/** Where one stands on a land level: the ground, or one block higher. The sea is level with the ground. */
export function groundOfTier(ground: number, tier: number): number {
  return ground + Math.min(1, Math.max(0, tier))
}

export function shape(ctx: WorldGenContext, cfg: Config): void {
  const { sizeX, sizeZ } = ctx
  const n = sizeX * sizeZ
  const tier = new Int8Array(n)
  const coast = ctx.noise('coast')
  const coast2 = ctx.noise('coast-detail')
  const tierNoise = ctx.noise('tiers')
  const floorNoise = ctx.noise('ocean-floor')
  const cx = sizeX / 2
  const cz = sizeZ / 2
  const half = Math.min(sizeX, sizeZ) / 2
  const { size, coastNoise, coastScale, oceanDepth } = cfg.island
  const tiers = cfg.tiers.count

  // 1. "Radial coordinate" of every cell: distance from the center divided by a noisy coast radius.
  //    A cell is land when this value is below a threshold.
  const r = new Float32Array(n).fill(Infinity)
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz) / half
      if (d >= MAX_LAND_RADIUS) continue // a ring of sea always stays inside the world
      const wobble = 1 + coast(x * coastScale, z * coastScale) * coastNoise + coast2(x * coastScale * 3, z * coastScale * 3) * coastNoise * 0.3
      r[ctx.index(x, z)] = d / Math.max(0.2, wobble)
    }
  }

  // 2. Pick the threshold that gives the requested land area — the island is the same size for every seed.
  const threshold = quantile(r, size)
  let land: Uint8Array = new Uint8Array(n)
  for (let i = 0; i < n; i++) if (r[i]! < threshold) land[i] = 1

  // 3. Exactly one island: drop detached islets, fill enclosed lagoons (ponds/rivers come later).
  land = keepLargestComponent(land, sizeX, sizeZ)
  fillEnclosedWater(land, sizeX, sizeZ)

  // 4. Terraces: higher further inland, broken up by noise.
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      const i = ctx.index(x, z)
      if (land[i]) {
        const inland = Math.max(0, Math.min(1, 1 - r[i]! / threshold))
        const v = (tierNoise(x * cfg.tiers.scale, z * cfg.tiers.scale) * 0.5 + 0.5) * 0.8 + inland * cfg.tiers.inlandBias + cfg.tiers.offset
        tier[i] = Math.max(0, Math.min(tiers - 1, Math.floor(v * tiers)))
      } else {
        tier[i] = -1
        // Varied sea floor, flattening towards the world edge to meet the sea bed around the world.
        const edgeDist = Math.min(x, z, sizeX - 1 - x, sizeZ - 1 - z)
        const vary = Math.min(1, edgeDist / 8)
        const depth = oceanDepth + 1 + Math.round(floorNoise(x * 0.08, z * 0.08) * 1.2 * vary)
        ctx.heightMap[i] = Math.max(1, ctx.sea - depth)
        ctx.waterMap[i] = ctx.sea
      }
    }
  }

  // Majority filter: removes 1-block bumps and pits so cliffs form clean terraces.
  for (let pass = 0; pass < cfg.tiers.smoothing; pass++) {
    const copy = tier.slice()
    for (let z = 1; z < sizeZ - 1; z++) {
      for (let x = 1; x < sizeX - 1; x++) {
        const i = ctx.index(x, z)
        if (!land[i]) continue
        const counts = new Map<number, number>()
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const t = copy[ctx.index(x + dx, z + dz)]!
            if (t >= 0) counts.set(t, (counts.get(t) ?? 0) + 1)
          }
        }
        let best = copy[i]!
        let bestCount = 0
        for (const [t, c] of counts) if (c > bestCount || (c === bestCount && t < best)) [best, bestCount] = [t, c]
        if (bestCount >= 5) tier[i] = best
      }
    }
  }

  let area = 0
  for (let i = 0; i < n; i++) {
    if (!land[i]) continue
    area++
    ctx.heightMap[i] = groundOfTier(ctx.ground, tier[i]!)
  }
  ctx.data.terrain = {
    land,
    tier,
    river: new Uint8Array(n),
    oceanDistance: new Int16Array(n),
    landFraction: area / n,
  } satisfies TerrainData
}

/** Land never reaches beyond this fraction of the half-size, so the island is always surrounded by sea. */
export const MAX_LAND_RADIUS = 0.9

/** Value below which `fraction` of ALL cells lie (Infinity-valued cells count as above). */
export function quantile(values: Float32Array, fraction: number): number {
  const finite = Array.from(values)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  if (!finite.length) return 0
  const k = Math.floor(Math.max(0, Math.min(1, fraction)) * values.length)
  if (k >= finite.length) return finite[finite.length - 1]! + 1e-6
  return finite[k]!
}

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

/** Flood fill from `starts` over cells where `pass(i)` is true; returns visited flags. */
function flood(sizeX: number, sizeZ: number, starts: number[], pass: (i: number) => boolean): Uint8Array {
  const seen = new Uint8Array(sizeX * sizeZ)
  const queue: number[] = []
  for (const s of starts) if (pass(s) && !seen[s]) ((seen[s] = 1), queue.push(s))
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!
    const x = i % sizeX
    const z = (i / sizeX) | 0
    for (const [dx, dz] of NEIGHBOURS) {
      const nx = x + dx
      const nz = z + dz
      if (nx < 0 || nz < 0 || nx >= sizeX || nz >= sizeZ) continue
      const j = nx + nz * sizeX
      if (!seen[j] && pass(j)) ((seen[j] = 1), queue.push(j))
    }
  }
  return seen
}

/** Keep only the biggest 4-connected piece of land. */
export function keepLargestComponent(land: Uint8Array, sizeX: number, sizeZ: number): Uint8Array {
  const label = new Int32Array(land.length).fill(-1)
  let best = -1
  let bestSize = 0
  let next = 0
  for (let i = 0; i < land.length; i++) {
    if (!land[i] || label[i] !== -1) continue
    const comp = flood(sizeX, sizeZ, [i], (j) => land[j] === 1 && label[j] === -1)
    let count = 0
    for (let j = 0; j < comp.length; j++) if (comp[j]) ((label[j] = next), count++)
    if (count > bestSize) [best, bestSize] = [next, count]
    next++
  }
  const out = new Uint8Array(land.length)
  for (let i = 0; i < land.length; i++) if (label[i] === best) out[i] = 1
  return out
}

/** Water not connected to the world border becomes land (lagoons inside the island). */
export function fillEnclosedWater(land: Uint8Array, sizeX: number, sizeZ: number): void {
  const border: number[] = []
  for (let x = 0; x < sizeX; x++) border.push(x, x + (sizeZ - 1) * sizeX)
  for (let z = 0; z < sizeZ; z++) border.push(z * sizeX, sizeX - 1 + z * sizeX)
  const sea = flood(sizeX, sizeZ, border, (i) => !land[i])
  for (let i = 0; i < land.length; i++) if (!land[i] && !sea[i]) land[i] = 1
}

/** Carve a disc of river/pond around (x, z): bed one below the reference ground, water up to the brim
 * (the liquid surface is drawn a little lower, so it sits just under the grass). */
export const WATER_RIVER = 1
export const WATER_POND = 2

export function carve(ctx: WorldGenContext, x: number, z: number, r: number, ground: number, kind = WATER_RIVER): void {
  const t = td(ctx)
  const bed = ground - 1
  const ri = Math.ceil(r)
  for (let dz = -ri; dz <= ri; dz++) {
    for (let dx = -ri; dx <= ri; dx++) {
      if (dx * dx + dz * dz > r * r + 0.3) continue
      const px = Math.round(x) + dx
      const pz = Math.round(z) + dz
      if (px < 1 || pz < 1 || px >= ctx.sizeX - 1 || pz >= ctx.sizeZ - 1) continue
      const i = ctx.index(px, pz)
      if (!t.land[i]) continue
      if (ctx.heightMap[i]! < bed) continue // already lower (e.g. a lower terrace)
      ctx.heightMap[i] = bed
      ctx.waterMap[i] = Math.max(ctx.waterMap[i]!, bed + 1)
      if (!t.river[i]) t.river[i] = kind
    }
  }
}

export function rivers(ctx: WorldGenContext, cfg: Config): void {
  const t = td(ctx)
  const rng = ctx.rng('rivers')
  const meander = ctx.noise('meander')
  const cx = ctx.sizeX / 2
  const cz = ctx.sizeZ / 2
  let maxTier = 0
  for (const v of t.tier) if (v > maxTier) maxTier = v
  const r = cfg.rivers.width / 2

  for (let k = 0; k < cfg.rivers.count; k++) {
    // Start somewhere in the highlands, away from the exact center.
    let sx = cx
    let sz = cz
    for (let tries = 0; tries < 200; tries++) {
      const a = rng() * Math.PI * 2
      const d = (0.08 + rng() * 0.25) * Math.min(ctx.sizeX, ctx.sizeZ)
      const x = Math.floor(cx + Math.cos(a) * d)
      const z = Math.floor(cz + Math.sin(a) * d)
      if (t.tier[ctx.index(x, z)] === maxTier) {
        sx = x
        sz = z
        break
      }
    }
    // Head outwards with a noisy meander until the sea.
    let x = sx
    let z = sz
    let heading = Math.atan2(sz - cz, sx - cx) + (rng() - 0.5)
    let prevGround = Infinity
    let prevWater = 0
    for (let step = 0; step < ctx.sizeX * 3; step++) {
      const xi = Math.round(x)
      const zi = Math.round(z)
      if (xi < 1 || zi < 1 || xi >= ctx.sizeX - 1 || zi >= ctx.sizeZ - 1) break
      const i = ctx.index(xi, zi)
      if (!t.land[i]) break
      const ground = Math.min(prevGround, groundOfTier(ctx.ground, t.tier[i]!))
      carve(ctx, xi, zi, r, ground)
      // Waterfall: where the river drops a terrace, stack water up to the level above.
      if (prevWater && ground < prevWater) ctx.waterMap[i] = Math.max(ctx.waterMap[i]!, prevWater)
      prevGround = ground
      prevWater = ground
      const outward = Math.atan2(z - cz, x - cx)
      heading = outward + meander(x * 0.05 + k * 31.7, z * 0.05) * cfg.rivers.meander
      x += Math.cos(heading)
      z += Math.sin(heading)
    }
  }
}

export function ponds(ctx: WorldGenContext, cfg: Config): void {
  const t = td(ctx)
  const rng = ctx.rng('ponds')
  let made = 0
  for (let tries = 0; tries < 300 && made < cfg.ponds.count; tries++) {
    const x = 4 + Math.floor(rng() * (ctx.sizeX - 8))
    const z = 4 + Math.floor(rng() * (ctx.sizeZ - 8))
    const i = ctx.index(x, z)
    const tier = t.tier[i]!
    if (tier < 0 || t.river[i]) continue
    // Needs flat ground around it.
    const r = cfg.ponds.radius * (0.7 + rng() * 0.6)
    const R = Math.ceil(r) + 2
    let flat = true
    for (let dz = -R; dz <= R && flat; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const j = ctx.index(Math.min(ctx.sizeX - 1, Math.max(0, x + dx)), Math.min(ctx.sizeZ - 1, Math.max(0, z + dz)))
        if (t.tier[j] !== tier || t.river[j]) {
          flat = false
          break
        }
      }
    }
    if (!flat) continue
    carve(ctx, x, z, r, groundOfTier(ctx.ground, tier), WATER_POND)
    made++
  }
}

export function surface(ctx: WorldGenContext, cfg: Config): void {
  const t = td(ctx)
  const { sizeX, sizeZ } = ctx
  const b = cfg.blocks
  // Distance (in cells) to the ocean, by BFS from all ocean cells.
  const dist = t.oceanDistance.fill(-1)
  const queue: number[] = []
  for (let i = 0; i < dist.length; i++) if (!t.land[i]) ((dist[i] = 0), queue.push(i))
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!
    const x = i % sizeX
    const z = (i / sizeX) | 0
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx
      const nz = z + dz
      if (nx < 0 || nz < 0 || nx >= sizeX || nz >= sizeZ) continue
      const j = ctx.index(nx, nz)
      if (dist[j] !== -1) continue
      dist[j] = dist[i]! + 1
      queue.push(j)
    }
  }
  const sandNoise = ctx.noise('beach')
  for (let i = 0; i < dist.length; i++) {
    const x = i % sizeX
    const z = (i / sizeX) | 0
    if (!t.land[i]) ctx.surface[i] = b.sand
    else if (t.river[i]) ctx.surface[i] = b.sand
    else if (t.tier[i] === 0 && dist[i]! <= cfg.beachWidth + Math.round(sandNoise(x * 0.15, z * 0.15) * 1.5)) {
      ctx.surface[i] = b.sand
    } else ctx.surface[i] = b.grass
  }
}

export function voxels(ctx: WorldGenContext, cfg: Config): void {
  const t = td(ctx)
  const b = cfg.blocks
  const planks = ctx.block(b.planks)
  const n = {
    grass: ctx.block(b.grass),
    dirt: ctx.block(b.dirt),
    sand: ctx.block(b.sand),
    cliff: ctx.block(b.cliff),
    stone: ctx.block(b.stone),
    water: ctx.block(b.water),
  }
  const w = ctx.world
  for (let z = 0; z < ctx.sizeZ; z++) {
    for (let x = 0; x < ctx.sizeX; x++) {
      const i = ctx.index(x, z)
      const h = Math.min(ctx.height, ctx.heightMap[i]!)
      if (h <= 0) continue
      const top = ctx.surface[i] ? ctx.block(ctx.surface[i]!) : n.grass
      const isSand = top === n.sand
      // Layers from the top: surface, (sand under beaches), layered cliff rock, stone base.
      // Cliff faces therefore show the grass lip over warm rock strata.
      w.fillColumn(x, z, 0, Math.min(h, 2), n.stone)
      if (h > 2) w.fillColumn(x, z, 2, h, n.cliff)
      if (isSand) w.fillColumn(x, z, Math.max(0, h - 3), h - 1, n.sand)
      w.fillColumn(x, z, h - 1, h, top)
      const water = Math.min(ctx.height, ctx.waterMap[i]!)
      if (water > h) w.fillColumn(x, z, h, water, n.water)
      const deck = t.bridge?.[i] ?? 0
      if (deck > 0) w.fillColumn(x, z, deck - 1, deck, planks)
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Walkability

/** Height a walker stands at in a column, or -1 if it can't stand there (water, sea). */
export function standHeight(ctx: WorldGenContext, i: number): number {
  const t = td(ctx)
  const deck = t.bridge?.[i] ?? 0
  if (deck > 0) return deck
  if (!t.land[i] || ctx.waterMap[i]! > ctx.heightMap[i]!) return -1
  return ctx.heightMap[i]!
}

/** 4-connected regions where neighbours differ by at most `step` in height. */
export function walkRegions(sizeX: number, sizeZ: number, height: (i: number) => number, step: number) {
  const label = new Int32Array(sizeX * sizeZ).fill(-1)
  const sizes: number[] = []
  for (let start = 0; start < label.length; start++) {
    if (label[start] !== -1 || height(start) < 0) continue
    const id = sizes.length
    let count = 0
    const queue = [start]
    label[start] = id
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head]!
      count++
      const x = i % sizeX
      const z = (i / sizeX) | 0
      const h = height(i)
      for (const [dx, dz] of NEIGHBOURS) {
        const nx = x + dx
        const nz = z + dz
        if (nx < 0 || nz < 0 || nx >= sizeX || nz >= sizeZ) continue
        const j = nx + nz * sizeX
        if (label[j] !== -1) continue
        const hj = height(j)
        if (hj < 0 || Math.abs(hj - h) > step) continue
        label[j] = id
        queue.push(j)
      }
    }
    sizes.push(count)
  }
  return { label, sizes }
}

/**
 * Make the island walkable: repeatedly join the biggest region to another one with
 * stairs (down a cliff, built on the lower side) or a bridge (straight over a river or pond).
 */
export function connect(ctx: WorldGenContext, cfg: Config): void {
  const t = td(ctx)
  const { sizeX, sizeZ } = ctx
  const n = sizeX * sizeZ
  const step = cfg.paths.step
  t.bridge = new Int16Array(n)
  t.stairs = new Uint8Array(n)
  t.stairsBuilt = 0
  t.bridgesBuilt = 0
  const rng = ctx.rng('connect')
  const h = (i: number) => standHeight(ctx, i)
  const inside = (x: number, z: number) => x >= 1 && z >= 1 && x < sizeX - 1 && z < sizeZ - 1

  let regions = walkRegions(sizeX, sizeZ, h, step)
  for (let iter = 0; iter < cfg.paths.maxConnectors; iter++) {
    const { label, sizes } = regions
    const main = sizes.indexOf(Math.max(...sizes))
    const big = (id: number) => id >= 0 && id !== main && sizes[id]! >= cfg.paths.minRegion
    if (main < 0 || !sizes.some((_, id) => big(id))) break

    // Cells of the main region in random order.
    const cells: number[] = []
    for (let i = 0; i < n; i++) if (label[i] === main) cells.push(i)
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[cells[i], cells[j]] = [cells[j]!, cells[i]!]
    }

    let done = false
    for (const a of cells) {
      const ax = a % sizeX
      const az = (a / sizeX) | 0
      for (const [dx, dz] of NEIGHBOURS) {
        if (tryBridge(ax, az, dx, dz) || tryStairs(ax, az, dx, dz)) {
          done = true
          break
        }
      }
      if (done) break
    }
    if (!done) break
    regions = walkRegions(sizeX, sizeZ, h, step)

    function tryBridge(ax: number, az: number, dx: number, dz: number): boolean {
      const a = ctx.index(ax, az)
      const deck = h(a)
      for (let len = 1; len <= cfg.paths.maxBridge; len++) {
        const x = ax + dx * len
        const z = az + dz * len
        if (!inside(x, z)) return false
        const i = ctx.index(x, z)
        if (t.river[i]) {
          // the deck must sit above the water surface
          // the deck replaces the top water cell; it must not be under deeper water
          if (ctx.waterMap[i]! > deck || ctx.heightMap[i]! > deck - 1) return false
          continue
        }
        if (len === 1 || h(i) !== deck || !big(label[i]!)) return false
        // Build: two planks wide when the parallel line is also valid.
        const span = (ox: number, oz: number) => {
          const out: number[] = []
          for (let m = 1; m < len; m++) {
            const j = ctx.index(ax + dx * m + ox, az + dz * m + oz)
            if (!t.river[j] || ctx.waterMap[j]! > deck) return null
            out.push(j)
          }
          return out
        }
        const main0 = span(0, 0)!
        const side = span(dz, dx) ?? span(-dz, -dx) ?? []
        for (const j of [...main0, ...side]) t.bridge![j] = deck
        t.bridgesBuilt!++
        return true
      }
      return false
    }

    function tryStairs(ax: number, az: number, dx: number, dz: number): boolean {
      const a = ctx.index(ax, az)
      const bx = ax + dx
      const bz = az + dz
      if (!inside(bx, bz)) return false
      const b = ctx.index(bx, bz)
      const ha = h(a)
      const hb = h(b)
      if (hb < 0 || !big(label[b]!) || Math.abs(ha - hb) <= step) return false
      // Stairs go on the lower side, walking away from the cliff.
      const [lowX, lowZ, high, low, sx, sz] = ha > hb ? [bx, bz, ha, hb, dx, dz] : [ax, az, hb, ha, -dx, -dz]
      const k = Math.ceil((high - low) / step) - 1 // steps between the cliff top and the lower ground
      const line = (ox: number, oz: number) => {
        const out: number[] = []
        for (let m = 0; m <= k; m++) {
          const x = lowX + sx * m + ox
          const z = lowZ + sz * m + oz
          if (!inside(x, z)) return null
          const j = ctx.index(x, z)
          if (h(j) !== low || t.river[j] || t.stairs![j] || t.bridge![j]) return null
          out.push(j)
        }
        return out
      }
      const first = line(0, 0)
      if (!first) return false
      const second = line(sz, sx) ?? line(-sz, -sx)
      for (const cellsLine of [first, second]) {
        if (!cellsLine) continue
        for (let m = 0; m < k; m++) {
          const j = cellsLine[m]!
          ctx.heightMap[j] = high - step * (m + 1)
          t.stairs![j] = 1
        }
      }
      t.stairsBuilt!++
      return true
    }
  }
  const big = regions.sizes.filter((s) => s >= cfg.paths.minRegion)
  t.regions = big.length
}

export type WaterKind = 'sea' | 'river' | 'pond'

/** What kind of water a column holds by generation: inland river or pond, or sea outside the land. */
export function waterKindAt(t: Pick<TerrainData, 'land' | 'river'>, i: number): WaterKind {
  const r = t.river[i]
  if (r === WATER_POND) return 'pond'
  if (r) return 'river'
  return t.land[i] ? 'pond' : 'sea' // water on land that wasn't carved (rare): treat as still water
}
