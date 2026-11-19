/**
 * Island generator: terraced island → rivers with waterfalls → ponds → beaches → voxels.
 * Every step is an entry in the `worldgen` registry, so other plugins can add steps between these
 * (orders 100…400), replace one (`registry.modify(id, s => ({ ...s, run }))`) or switch it off.
 * All numbers live in config/terrain.json5 and are tunable live in the debug panel (F2): the world regenerates.
 */
import { definePlugin, z, type WorldGenContext } from '@sdk'

const Config = z.object({
  waterLevel: z.number().int().min(2).max(60).default(8).meta({ label: 'water level', step: 1 }),
  island: z
    .object({
      radius: z.number().min(0.2).max(1).default(0.8).meta({ step: 0.01 }),
      coastNoise: z.number().min(0).max(1).default(0.22).meta({ label: 'coast noise', step: 0.01 }),
      coastScale: z.number().min(0.005).max(0.2).default(0.045).meta({ label: 'coast scale', step: 0.005 }),
      oceanDepth: z.number().int().min(1).max(10).default(3).meta({ label: 'ocean depth', step: 1 }),
    })
    .prefault({}),
  tiers: z
    .object({
      count: z.number().int().min(1).max(6).default(3).meta({ step: 1 }),
      height: z.number().int().min(1).max(8).default(3).meta({ label: 'cliff height', step: 1 }),
      scale: z.number().min(0.005).max(0.2).default(0.03).meta({ step: 0.005 }),
      inlandBias: z.number().min(0).max(2).default(0.9).meta({ label: 'inland bias', step: 0.05 }),
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
  blocks: z
    .object({
      grass: z.string().default('core:grass'),
      dirt: z.string().default('core:dirt'),
      sand: z.string().default('core:sand'),
      cliff: z.string().default('core:cliff'),
      stone: z.string().default('core:stone'),
      water: z.string().default('core:water'),
    })
    .prefault({}),
})
type Config = z.infer<typeof Config>

/** Data the terrain steps share through `ctx.data` (other plugins may read it too). */
export interface TerrainData {
  land: Uint8Array
  tier: Int8Array
  river: Uint8Array
  oceanDistance: Int16Array
}

const td = (ctx: WorldGenContext) => ctx.data.terrain as TerrainData

export default definePlugin({
  id: 'terrain',
  version: '0.1.0',
  description: 'Генератор острова с террасами, реками, прудами и пляжами',

  setup(api) {
    const cfg = api.config.define(Config)
    api.config.onChange(() => api.world.regenerateSoon())
    const steps = api.registry('worldgen')

    steps.register({
      id: 'terrain:shape',
      order: 100,
      description: 'Island mask and terraced height levels',
      run: (ctx) => shape(ctx, cfg),
    })
    steps.register({
      id: 'terrain:rivers',
      order: 200,
      description: 'Rivers from the highlands to the sea, with waterfalls',
      run: (ctx) => rivers(ctx, cfg),
    })
    steps.register({
      id: 'terrain:ponds',
      order: 210,
      description: 'Small ponds on flat ground',
      run: (ctx) => ponds(ctx, cfg),
    })
    steps.register({
      id: 'terrain:surface',
      order: 300,
      description: 'Grass, beaches and river beds',
      run: (ctx) => surface(ctx, cfg),
    })
    steps.register({
      id: 'terrain:voxels',
      order: 400,
      description: 'Write columns (surface, soil, rock) and water into the world',
      run: (ctx) => voxels(ctx, cfg),
    })

    api.commands.register({
      name: 'seed',
      description: 'Новый остров: seed [число] (без числа — случайный)',
      usage: '[seed]',
      run: async ([s]) => {
        const seed = s ? Number(s) : Math.floor(Math.random() * 2 ** 31)
        await api.world.regenerate(seed)
        return `seed = ${seed}`
      },
    })
  },
})

// ---------------------------------------------------------------------------------------------

function groundOfTier(cfg: Config, tier: number): number {
  return cfg.waterLevel + 1 + tier * cfg.tiers.height
}

function shape(ctx: WorldGenContext, cfg: Config): void {
  const { sizeX, sizeZ } = ctx
  const n = sizeX * sizeZ
  const land = new Uint8Array(n)
  const tier = new Int8Array(n)
  const coast = ctx.noise('coast')
  const coast2 = ctx.noise('coast-detail')
  const tierNoise = ctx.noise('tiers')
  const floorNoise = ctx.noise('ocean-floor')
  const cx = sizeX / 2
  const cz = sizeZ / 2
  const half = Math.min(sizeX, sizeZ) / 2
  const { radius, coastNoise, coastScale, oceanDepth } = cfg.island
  const tiers = cfg.tiers.count

  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      const i = ctx.index(x, z)
      const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz) / half
      const edge =
        radius * (1 + coast(x * coastScale, z * coastScale) * coastNoise + coast2(x * coastScale * 3, z * coastScale * 3) * coastNoise * 0.3)
      if (d < edge) {
        land[i] = 1
        const inland = Math.min(1, (edge - d) / edge)
        const v = (tierNoise(x * cfg.tiers.scale, z * cfg.tiers.scale) * 0.5 + 0.5) * 0.8 + inland * cfg.tiers.inlandBias - 0.45
        tier[i] = Math.max(0, Math.min(tiers - 1, Math.floor(v * tiers)))
      } else {
        tier[i] = -1
        const depth = oceanDepth + Math.round((floorNoise(x * 0.08, z * 0.08) * 0.5 + 0.5) * 1.5)
        ctx.heightMap[i] = Math.max(1, cfg.waterLevel - depth)
        ctx.waterMap[i] = cfg.waterLevel
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

  for (let i = 0; i < n; i++) if (land[i]) ctx.heightMap[i] = groundOfTier(cfg, tier[i]!)
  ctx.data.terrain = { land, tier, river: new Uint8Array(n), oceanDistance: new Int16Array(n) } satisfies TerrainData
}

/** Carve a disc of river/pond around (x, z): bed two below the reference ground, water one below. */
function carve(ctx: WorldGenContext, x: number, z: number, r: number, ground: number): void {
  const t = td(ctx)
  const bed = ground - 2
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
      t.river[i] = 1
    }
  }
}

function rivers(ctx: WorldGenContext, cfg: Config): void {
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
      const ground = Math.min(prevGround, groundOfTier(cfg, Math.max(0, t.tier[i]!)))
      carve(ctx, xi, zi, r, ground)
      // Waterfall: where the river drops a terrace, stack water up to the level above.
      if (prevWater && ground - 1 < prevWater) ctx.waterMap[i] = Math.max(ctx.waterMap[i]!, prevWater)
      prevGround = ground
      prevWater = ground - 1
      const outward = Math.atan2(z - cz, x - cx)
      heading = outward + meander(x * 0.05 + k * 31.7, z * 0.05) * cfg.rivers.meander
      x += Math.cos(heading)
      z += Math.sin(heading)
    }
  }
}

function ponds(ctx: WorldGenContext, cfg: Config): void {
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
    carve(ctx, x, z, r, groundOfTier(cfg, tier))
    made++
  }
}

function surface(ctx: WorldGenContext, cfg: Config): void {
  const t = td(ctx)
  const { sizeX, sizeZ } = ctx
  const b = cfg.blocks
  // Distance (in cells) to the ocean, by BFS from all ocean cells.
  const dist = t.oceanDistance.fill(-1)
  const queue: number[] = []
  for (let i = 0; i < dist.length; i++) if (!t.land[i]) (dist[i] = 0), queue.push(i)
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

function voxels(ctx: WorldGenContext, cfg: Config): void {
  const b = cfg.blocks
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
      // Layers from the top: surface, soil (2), then cliff rock down to the stone base.
      w.fillColumn(x, z, 0, Math.min(h, 2), n.stone)
      if (h > 2) w.fillColumn(x, z, 2, h, n.cliff)
      w.fillColumn(x, z, Math.max(0, h - 3), h - 1, isSand ? n.sand : n.dirt)
      w.fillColumn(x, z, h - 1, h, top)
      const water = Math.min(ctx.height, ctx.waterMap[i]!)
      if (water > h) w.fillColumn(x, z, h, water, n.water)
    }
  }
}
