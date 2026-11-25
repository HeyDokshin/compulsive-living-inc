/** Save file format. Bump SAVE_FORMAT and add a migration in migrations.ts when it changes. */
export const SAVE_FORMAT = 1

export interface SaveMeta {
  slot: string
  name: string
  /** The player's name (saves before 0.11 have none). */
  player?: string
  createdAt: number
  savedAt: number
  /** Seconds of play. */
  playTime: number
  seed: number
  /** Game build that wrote it (package version). */
  gameVersion: string
}

export interface SavedWorld {
  /** World shape (seed, chunks, height) — applied before generating. */
  config: Record<string, unknown>
  /** Block ids by saved number (0 = air). */
  palette: string[]
  chunksX: number
  chunksZ: number
  height: number
  /** All chunks, run-length encoded: [value, run, value, run, …]. */
  voxels: Uint32Array
}

export interface SavedEntity {
  components: Record<string, unknown>
}

export interface SavedPlugin {
  version: number
  data: unknown
}

export interface SaveData {
  format: number
  meta: SaveMeta
  world: SavedWorld
  entities: SavedEntity[]
  plugins: Record<string, SavedPlugin>
}
