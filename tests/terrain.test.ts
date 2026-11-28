import { describe, expect, it } from 'vitest'
import { VoxelWorld } from '../src/engine/world/VoxelWorld'
import { generateWorld, type WorldGenStep } from '../src/engine/world/WorldGen'
import {
  Config,
  connect,
  fillEnclosedWater,
  keepLargestComponent,
  ponds,
  quantile,
  rivers,
  shape,
  surface,
  voxels,
  type TerrainData,
} from '../src/plugins/terrain/gen'

const cfg = Config.parse({})
const steps: WorldGenStep[] = [
  { id: 't:shape', order: 100, run: (c) => shape(c, cfg) },
  { id: 't:rivers', order: 200, run: (c) => rivers(c, cfg) },
  { id: 't:ponds', order: 210, run: (c) => ponds(c, cfg) },
  { id: 't:paths', order: 250, run: (c) => connect(c, cfg) },
  { id: 't:surface', order: 300, run: (c) => surface(c, cfg) },
  { id: 't:voxels', order: 400, run: (c) => voxels(c, cfg) },
]

async function island(seed: number) {
  let data: TerrainData | undefined
  const world = new VoxelWorld()
  await generateWorld(world, [...steps, { id: 't:grab', order: 999, run: (c) => void (data = c.data.terrain as TerrainData) }], {
    seed,
    chunksX: 8,
    chunksZ: 8,
    height: 32,
  })
  return { world, data: data! }
}

function components(land: Uint8Array, sx: number, sz: number): number {
  let count = 0
  let rest = land.slice()
  while (rest.some((v) => v)) {
    const biggest = keepLargestComponent(rest, sx, sz)
    rest = rest.map((v, i) => (biggest[i] ? 0 : v))
    count++
  }
  return count
}

describe('terrain island', () => {
  it('is one island of about the same size for every seed, inside a 128×128 world', async () => {
    const fractions: number[] = []
    for (const seed of [1, 2, 3, 42, 777, 12345, 99999, 2024]) {
      const { world, data } = await island(seed)
      expect(world.sizeX).toBe(128)
      expect(components(data.land, 128, 128)).toBe(1)
      fractions.push(data.landFraction)
      // never touches the world edge
      for (let x = 0; x < 128; x++) {
        expect(data.land[x]).toBe(0)
        expect(data.land[x + 127 * 128]).toBe(0)
      }
    }
    for (const f of fractions) expect(f).toBeGreaterThan(0.34)
    expect(Math.max(...fractions) - Math.min(...fractions)).toBeLessThan(0.06)
  })

  it('is fully walkable: stairs and bridges join every region (step 1)', async () => {
    const report: string[] = []
    for (const seed of [1, 2, 3, 42, 777, 12345, 99999, 2024]) {
      const { world, data } = await island(seed)
      report.push(`${seed}: regions=${data.regions} stairs=${data.stairsBuilt} bridges=${data.bridgesBuilt}`)
      expect(data.regions, report.join('\n')).toBe(1)
      // a bridge deck is a plank block whose top is the walkable height
      data.bridge!.forEach((deck, i) => {
        if (deck) expect(world.getId(i % 128, deck - 1, (i / 128) | 0)).toBe('core:planks')
      })
    }
  })

  it('has two land levels at most: the ground (level with the sea) and one block higher', async () => {
    const ground = 8
    for (const seed of [1, 2, 3, 42, 777, 12345, 99999, 2024]) {
      const { world, data } = await island(seed)
      let low = 0
      let high = 0
      for (let z = 0; z < 128; z++) {
        for (let x = 0; x < 128; x++) {
          const i = x + z * 128
          let top = 0
          for (let y = 31; y >= 0; y--)
            if (world.getId(x, y, z) !== 'air') {
              top = y + 1
              break
            }
          if (!data.land[i]) {
            // the sea: water up to the ground level, nothing above
            expect(top, `sea ${x},${z}`).toBe(ground)
            expect(world.getId(x, ground - 1, z)).toBe('core:water')
            continue
          }
          expect(top, `land ${x},${z}`).toBeGreaterThanOrEqual(ground)
          expect(top, `land ${x},${z}`).toBeLessThanOrEqual(ground + 1)
          if (data.river[i] || data.bridge![i]) continue
          if (top === ground) low++
          else high++
        }
      }
      // most of the island is on the ground level, where the buildings go
      expect(low / (low + high), `seed ${seed}`).toBeGreaterThan(0.5)
      expect(high, `seed ${seed}`).toBeGreaterThan(0)
    }
  })

  it('helpers: quantile, largest component, enclosed water', () => {
    expect(quantile(new Float32Array([3, 1, 2, Infinity]), 0.5)).toBe(3)
    // two blobs: keep the 2-cell one
    const land = new Uint8Array([1, 1, 0, 0, 0, 0, 0, 1, 0])
    expect([...keepLargestComponent(land, 3, 3)]).toEqual([1, 1, 0, 0, 0, 0, 0, 0, 0])
    // ring of land with a hole in the middle → hole filled
    const ring = new Uint8Array(25)
    for (const i of [6, 7, 8, 11, 13, 16, 17, 18]) ring[i] = 1
    fillEnclosedWater(ring, 5, 5)
    expect(ring[12]).toBe(1)
    expect(ring[0]).toBe(0)
  })
})
