import { SAVE_FORMAT, type SaveData } from './format'

/**
 * Upgrades of the save file format, keyed by the version they upgrade FROM.
 * Example when format 2 arrives:
 *   1: (d) => ({ ...d, format: 2, newField: defaultValue }),
 */
const MIGRATIONS: Record<number, (data: SaveData) => SaveData> = {
  // 0.16: world levels. Older islands stood one block above the sea (land at 9, sea at 8): keep them
  // so, or buildings and newcomers find no ground level to stand on.
  1: (d) => ({ ...d, format: 2, world: { ...d.world, config: { ground: 9, sea: 8, ...d.world.config } } }),
}

export function migrateSave(data: SaveData): SaveData {
  let d = data
  while (d.format < SAVE_FORMAT) {
    const step = MIGRATIONS[d.format]
    if (!step) throw new Error(`no migration from save format ${d.format}`)
    d = step(d)
  }
  if (d.format > SAVE_FORMAT) throw new Error(`save format ${d.format} is newer than this game (${SAVE_FORMAT})`)
  return d
}
