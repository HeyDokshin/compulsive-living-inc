import type { Registry } from '../registry/Registry'
import type { ItemDef } from '../items/defs'
import type { BlockDef } from '../types'
import type { ModelLibrary } from '../models/ModelLibrary'
import type { BlockAtlas } from '../render/BlockAtlas'
import { faceTextures } from '../render/BlockAtlas'
import { TILE } from '../render/textures'
import { paintBlockIcon, paintDotIcon, paintSpriteIcon, paintVoxelIcon, prefersSprite } from './icons'

/** Item icons (data URLs), drawn once from the item's voxel model or block and cached. */
export class IconService {
  private cache = new Map<string, Promise<string>>()

  constructor(
    private items: Registry<ItemDef>,
    private blocks: Registry<BlockDef>,
    private library: ModelLibrary,
    private atlas: BlockAtlas,
  ) {}

  clear(): void {
    this.cache.clear()
  }

  item(id: string): Promise<string> {
    let p = this.cache.get(id)
    if (!p) {
      p = this.draw(id)
      this.cache.set(id, p)
    }
    return p
  }

  private async draw(id: string): Promise<string> {
    const def = this.items.get(id)
    if (!def) return paintDotIcon('#ff00ff')
    if (def.model) {
      const m = await this.library.getModel(def.model)
      if (m) {
        const style = def.icon?.style ?? (prefersSprite(m.model) ? 'sprite' : 'iso')
        return style === 'sprite' ? paintSpriteIcon(m.model, m.colors) : paintVoxelIcon(m.model, m.colors)
      }
    }
    if (def.icon?.block) {
      const block = this.blocks.get(def.icon.block)
      if (block) {
        const faces = faceTextures(block)
        const plan = this.atlas.plan
        const rect = (tex: string): [number, number, number, number] => {
          const i = Math.max(0, plan.tiles.indexOf(tex))
          return [(i % plan.cols) * TILE, Math.floor(i / plan.cols) * TILE, TILE, TILE]
        }
        return paintBlockIcon(this.atlas.canvas, rect(faces[2]!), rect(faces[4]!))
      }
    }
    return paintDotIcon(def.icon?.color ?? '#cccccc')
  }
}
