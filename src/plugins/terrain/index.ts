/**
 * Island generator: flat island with raised land one block high → rivers with waterfalls → ponds → beaches → voxels.
 * Every step is an entry in the `worldgen` registry, so other plugins can add steps between these
 * (orders 100…400), replace one (`registry.modify(id, s => ({ ...s, run }))`) or switch it off.
 * All numbers live in config/terrain.json5 and are tunable live in the debug panel (F2): the world regenerates.
 */
import { definePlugin, type PluginApi, type SurfaceRect } from '@sdk'
import { Config, connect, ponds, rivers, seaBedY, seaRing, shape, tileRects, surface, voxels, waterKindAt, type TerrainData, type WaterKind } from './gen'

export type { TerrainData, WaterKind } from './gen'

export interface TerrainWater {
  /** Kind of water in a column, or null when the column has no water on top. */
  kindAt(x: number, z: number): WaterKind | null
}

declare module '@sdk' {
  interface Services {
    'terrain:water': TerrainWater
  }
}

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
      id: 'terrain:paths',
      order: 250,
      description: 'Stairs between terraces and bridges over rivers until the island is walkable',
      run: (ctx) => connect(ctx, cfg),
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

    // Backdrop only — nothing is generated out there: a flat sea and sea bed drawn around the world.
    let sea: ReturnType<PluginApi['render']['blockSurface']>[] = []
    const buildSea = () => {
      for (const m of sea) {
        m.removeFromParent()
        m.geometry.dispose()
      }
      sea = []
      if (!cfg.seaBackdrop || !api.world.sizeX) return
      const sx = api.world.sizeX
      const sz = api.world.sizeZ
      // Rings around the world, finer near the island and coarser towards the horizon.
      const rings: SurfaceRect[] = [
        ...seaRing(sx, sz, 0, 24, 1),
        ...seaRing(sx, sz, 24, 64, 2),
        ...seaRing(sx, sz, 64, 160, 4),
        ...seaRing(sx, sz, 160, 480, 16),
      ]
      // in tiles, so only the sea in the picture is drawn
      for (const tile of tileRects(rings, cfg.seaTile)) {
        sea.push(api.render.blockSurface(cfg.blocks.sand, [tile], seaBedY(api.world.sea, cfg), { cull: true }))
        sea.push(api.render.blockSurface(cfg.blocks.water, [tile], api.world.sea - 0.125, { cull: true }))
      }
      showSea()
    }
    // Inside a room only the room is drawn: no sea around it.
    const showSea = () => {
      for (const m of sea) m.visible = !api.interiors.current
    }
    api.events.on('world:generated', buildSea)
    api.events.on('interior:changed', showSea)

    let last: TerrainData | undefined
    api.registry('worldgen').register({
      id: 'terrain:stats',
      order: 999,
      description: 'Remember island stats for the `island` command',
      run: (ctx) => void (last = ctx.data.terrain as TerrainData | undefined),
    })
    const liquids = api.registry('blocks')
    api.services.provide('terrain:water', {
      kindAt: (x, z) => {
        if (!last || x < 0 || z < 0 || x >= api.world.sizeX || z >= api.world.sizeZ) return null
        const y = api.world.surfaceY(x, z)
        // surfaceY is the first air above the top solid block; water sits on top of it
        if (!liquids.isTagged(api.world.getBlock(x, y, z), '#core:liquid')) return null
        return waterKindAt(last, x + z * api.world.sizeX)
      },
    })

    api.commands.register({
      name: 'island',
      description: 'Остров: площадь, лестницы, мосты, проходимость',
      run: () => {
        const cells = api.world.sizeX * api.world.sizeZ
        const f = last?.landFraction ?? 0
        return (
          `world ${api.world.sizeX}×${api.world.sizeZ}, land ${(f * 100).toFixed(1)}% ≈ ${Math.round(f * cells)} cells\n` +
          `stairs ${last?.stairsBuilt ?? 0}, bridges ${last?.bridgesBuilt ?? 0}, walkable regions ${last?.regions ?? '?'}`
        )
      },
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

