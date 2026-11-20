import type { Entities } from '../ecs/Entities'
import type { Hooks } from '../events/Hooks'
import type { Entity, GameHooks } from '../types'
import { AIR } from '../world/BlockPalette'
import type { VoxelWorld } from '../world/VoxelWorld'
import type { InteractionContext } from './Interactions'

/** Interaction context for the column (x, z): its top block and the entities standing there. */
export function cellContext(
  voxels: VoxelWorld,
  entities: Entities,
  hooks: Hooks<GameHooks>,
  actor: Entity,
  x: number,
  z: number,
  blockerAt?: (x: number, z: number) => Entity | undefined,
): InteractionContext {
  let y = -1
  for (let cy = voxels.height - 1; cy >= 0; cy--) {
    if (voxels.get(x, cy, z)) {
      y = cy
      break
    }
  }
  const here: Entity[] = []
  for (const e of entities.world.with('transform')) {
    if (e === actor) continue
    const t = e.transform
    if (Math.floor(t.x) === x && Math.floor(t.z) === z && Math.abs(t.y - (y + 1)) < 2) here.push(e)
  }
  // Big things (buildings) cover several cells: they count in every cell of their footprint.
  const big = blockerAt?.(x, z)
  if (big && big !== actor && !here.includes(big)) here.push(big)
  return {
    actor,
    held: hooks.run('interaction:held', null, { actor }),
    x,
    y,
    z,
    block: y >= 0 ? voxels.getId(x, y, z) : AIR,
    entities: here,
  }
}
