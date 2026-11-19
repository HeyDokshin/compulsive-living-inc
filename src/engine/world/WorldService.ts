import type { Registry } from '../registry/Registry'
import type { BlockDef, GameEvents, GameHooks } from '../types'
import type { EventBus } from '../events/EventBus'
import type { Hooks } from '../events/Hooks'
import type { WorldConfig } from '../engineConfig'
import { createLogger } from '../util/log'
import { AIR } from './BlockPalette'
import { VoxelWorld } from './VoxelWorld'
import { generateWorld, type GenerateReport, type WorldGenStep } from './WorldGen'

const log = createLogger('world')

/** Owns the voxel world: generation, regeneration on changes, and the block edit API for plugins. */
export class WorldService {
  readonly voxels = new VoxelWorld()
  lastReport?: GenerateReport
  private running: Promise<void> = Promise.resolve()
  private signature = ''
  private regenTimer?: ReturnType<typeof setTimeout>

  constructor(
    private cfg: WorldConfig,
    private blocks: Registry<BlockDef>,
    private steps: Registry<WorldGenStep>,
    private events: EventBus<GameEvents>,
    private hooks: Hooks<GameHooks>,
  ) {}

  /** Generate now (queued after any running generation). */
  regenerate(seed?: number): Promise<void> {
    if (seed !== undefined) this.cfg.seed = seed
    this.running = this.running.then(() => this.run())
    return this.running
  }

  /** Debounced regenerate — for sliders in the debug panel. */
  regenerateSoon(ms = 250): void {
    clearTimeout(this.regenTimer)
    this.regenTimer = setTimeout(() => void this.regenerate(), ms)
  }

  /** Regenerate only if the set of steps (or their code) changed, e.g. after a plugin hot reload. */
  async regenerateIfStepsChanged(): Promise<boolean> {
    if (this.stepSignature() === this.signature) return false
    await this.regenerate()
    return true
  }

  getBlock(x: number, y: number, z: number): string {
    return this.voxels.getId(x, y, z)
  }

  /** Plugin-facing edit: goes through the `world:beforeSetBlock` hook and emits `world:blockChanged`. */
  setBlock(x: number, y: number, z: number, id: string): boolean {
    if (!this.voxels.inBounds(x, y, z)) return false
    const from = this.voxels.getId(x, y, z)
    const r = this.hooks.run('world:beforeSetBlock', { id, cancelled: false }, { x, y, z, from })
    if (r.cancelled || r.id === from) return false
    if (r.id !== AIR && !this.blocks.has(r.id)) log.warn(`setBlock: unknown block "${r.id}"`)
    this.voxels.setId(x, y, z, r.id)
    this.events.emit('world:blockChanged', { x, y, z, from, to: r.id })
    return true
  }

  isSolid(x: number, y: number, z: number): boolean {
    const n = this.voxels.get(x, y, z)
    if (n === 0) return false
    return this.blocks.get(this.voxels.palette.id(n))?.solid ?? true
  }

  /** Y of the cell above the highest solid block (where something can stand). */
  surfaceY(x: number, z: number): number {
    const fx = Math.floor(x)
    const fz = Math.floor(z)
    for (let y = this.voxels.height - 1; y >= 0; y--) if (this.isSolid(fx, y, fz)) return y + 1
    return 0
  }

  private stepSignature(): string {
    return this.steps
      .all()
      .map((s) => `${s.id}:${s.order}:${s.enabled !== false}:${fnId(s.run)}`)
      .sort()
      .join('|')
  }

  private async run(): Promise<void> {
    this.signature = this.stepSignature()
    const { seed, chunksX, chunksZ, height } = this.cfg
    const report = await generateWorld(this.voxels, this.steps.all(), { seed, chunksX, chunksZ, height }, (...a) =>
      log.warn(...a),
    )
    this.lastReport = report
    log.info(
      `generated ${this.voxels.sizeX}×${height}×${this.voxels.sizeZ} seed=${seed} in ${report.ms.toFixed(0)} ms (${report.steps.length} steps)`,
    )
    if (!report.steps.length) log.warn('no worldgen steps registered — the world is empty')
    this.events.emit('world:generated', { seed, ms: report.ms })
  }
}

const fnIds = new WeakMap<Function, number>()
let nextFnId = 1
/** Identity of a function object: a hot-reloaded step gets a new id even with the same name. */
function fnId(fn: Function): number {
  let id = fnIds.get(fn)
  if (!id) fnIds.set(fn, (id = nextFnId++))
  return id
}
