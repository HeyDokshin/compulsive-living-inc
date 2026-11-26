import { createNoise2D } from 'simplex-noise'
import { WorldConfigSchema } from '../engineConfig'
import type { RegistryEntry } from '../registry/Registry'
import { mulberry32 } from '../render/textures'
import { AIR } from './BlockPalette'
import type { VoxelWorld } from './VoxelWorld'

/**
 * Shared state passed through all generation steps.
 * 2D maps are filled first (shape, rivers, beaches…), then a step writes voxels,
 * then decoration steps work on voxels. Steps exchange anything else through `data`.
 */
export interface WorldGenContext {
  seed: number
  sizeX: number
  sizeZ: number
  height: number
  /** Y a walker stands at on the lowest land (level 1); also the sea surface. */
  ground: number
  /** Levels from the ground up (see `api.world.levels`); natural land uses the first two at most. */
  levels: number
  /** Y of the sea surface: `ground`, except on islands made before 0.16 (one below). */
  sea: number
  world: VoxelWorld
  /** Column height: y of the first empty cell (0 = nothing). Index x + z * sizeX. */
  heightMap: Int16Array
  /** Block id of the top block per column ('' = decided by later steps). */
  surface: string[]
  /** Water surface level per column (0 = no water). */
  waterMap: Int16Array
  /** Free-form data shared between steps, e.g. `data.riverCells`. */
  data: Record<string, unknown>
  /** Deterministic RNG per salt (step id), so adding a step never changes other steps' output. */
  rng(salt: string): () => number
  /** Simplex noise in [-1, 1], deterministic per salt. */
  noise(salt: string): (x: number, z: number) => number
  /** Palette number of a block id (assigned if new). */
  block(id: string): number
  index(x: number, z: number): number
  log(...args: unknown[]): void
}

export interface WorldGenStep extends RegistryEntry {
  /** Lower runs first. Convention: 100 shape · 200 water · 300 surface · 400 voxels · 500+ decoration. */
  order: number
  description?: string
  /** Set false (e.g. via `registry.modify`) to switch a step off. */
  enabled?: boolean
  run(ctx: WorldGenContext): void | Promise<void>
}

export interface GenerateOptions {
  seed: number
  chunksX: number
  chunksZ: number
  height: number
  /** Defaults to the world config defaults. */
  ground?: number
  levels?: number
  /** Defaults to `ground`. */
  sea?: number
}

export interface GenerateReport {
  ms: number
  steps: { id: string; ms: number; error?: string }[]
}

const WORLD_DEFAULTS = WorldConfigSchema.parse({})

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Run all enabled steps in order on a freshly reset world. A failing step is reported and skipped. */
export async function generateWorld(
  world: VoxelWorld,
  steps: WorldGenStep[],
  opts: GenerateOptions,
  log: (...args: unknown[]) => void = () => {},
): Promise<GenerateReport> {
  const t0 = performance.now()
  world.reset(opts.chunksX, opts.chunksZ, opts.height)
  const sizeX = world.sizeX
  const sizeZ = world.sizeZ
  const ctx: WorldGenContext = {
    seed: opts.seed,
    sizeX,
    sizeZ,
    height: opts.height,
    ground: opts.ground ?? WORLD_DEFAULTS.ground,
    levels: opts.levels ?? WORLD_DEFAULTS.levels,
    sea: opts.sea ?? opts.ground ?? WORLD_DEFAULTS.ground,
    world,
    heightMap: new Int16Array(sizeX * sizeZ),
    surface: Array.from({ length: sizeX * sizeZ }, () => ''),
    waterMap: new Int16Array(sizeX * sizeZ),
    data: {},
    rng: (salt) => mulberry32(opts.seed ^ hashString(salt)),
    noise: (salt) => createNoise2D(mulberry32(opts.seed ^ hashString('noise:' + salt))),
    block: (id) => (id === AIR ? 0 : world.palette.num(id)),
    index: (x, z) => x + z * sizeX,
    log,
  }

  const report: GenerateReport = { ms: 0, steps: [] }
  const ordered = steps.filter((s) => s.enabled !== false).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  for (const step of ordered) {
    const s0 = performance.now()
    try {
      await step.run(ctx)
      report.steps.push({ id: step.id, ms: performance.now() - s0 })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      report.steps.push({ id: step.id, ms: performance.now() - s0, error })
      log(`step "${step.id}" failed: ${error}`)
    }
  }
  world.markAllDirty()
  report.ms = performance.now() - t0
  return report
}
