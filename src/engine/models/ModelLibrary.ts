import { BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, MeshLambertMaterial, type Material, type Object3D } from 'three'
import type { Registry } from '../registry/Registry'
import { stylize } from '../render/style'
import type { ModelDef, RigDef } from './defs'
import { buildVoxelGeometry, defaultPivot, parseLayers, parseVox, type GeometryData, type VoxelModel } from './voxelModel'
import { createLogger } from '../util/log'

const log = createLogger('models')

/**
 * Turns `models` / `rigs` registry entries into three.js objects.
 * Parsed models and geometries are cached; `.vox` files load asynchronously and appear when ready.
 */
export class ModelLibrary {
  private parsed = new Map<string, Promise<VoxelModel | null>>()
  private ready = new Map<string, VoxelModel | null>()
  private geometries = new Map<string, BufferGeometry>()
  readonly material: Material = stylize(new MeshLambertMaterial({ vertexColors: true }))

  constructor(
    private models: Registry<ModelDef>,
    private rigs: Registry<RigDef>,
  ) {}

  /** Drop caches (content changed). Existing objects keep their geometry until rebuilt. */
  clear(): void {
    this.parsed.clear()
    this.ready.clear()
    this.geometries.clear()
  }

  /** A single voxel model, scaled to world units. Empty group first if it is still loading. */
  createVoxel(id: string, opts: { scale?: number; palette?: Record<string, string> } = {}): Object3D {
    const group = new Group()
    group.name = id
    this.withModel(id, (model, def) => {
      const mesh = this.mesh(id, model, def.pivot ?? defaultPivot(model), opts.palette, def)
      const s = opts.scale ?? def.scale
      mesh.scale.setScalar(s)
      group.add(mesh)
    })
    return group
  }

  /** A rig: one pivot group per part (named after the part) holding that part's mesh. */
  createRig(id: string, opts: { scale?: number; palette?: Record<string, string>; parts?: Record<string, string> } = {}): Object3D {
    const root = new Group()
    root.name = id
    const rig = this.rigs.get(id)
    if (!rig) {
      log.warn(`unknown rig "${id}"`)
      return root
    }
    const scale = opts.scale ?? rig.scale
    const inner = new Group() // voxel space → world units
    inner.scale.setScalar(scale)
    root.add(inner)
    const byName = new Map<string, Group>()
    for (const part of rig.parts) {
      const pivotGroup = new Group()
      pivotGroup.name = part.name
      pivotGroup.position.set(...part.at)
      byName.set(part.name, pivotGroup)
    }
    for (const part of rig.parts) {
      const g = byName.get(part.name)!
      const parent = part.parent ? byName.get(part.parent) : undefined
      if (parent) {
        const p = rig.parts.find((q) => q.name === part.parent)!
        g.position.set(part.at[0] - p.at[0], part.at[1] - p.at[1], part.at[2] - p.at[2])
        parent.add(g)
      } else inner.add(g)
      const modelId = opts.parts?.[part.name] ?? part.model
      this.withModel(modelId, (model, def) => g.add(this.mesh(modelId, model, part.pivot, opts.palette, def)))
    }
    return root
  }

  /** Parsed model + its definition (for icons, tools, previews). */
  async getModel(id: string): Promise<{ model: VoxelModel; def: ModelDef; colors: string[] } | null> {
    const def = this.models.get(id)
    if (!def) return null
    const model = this.ready.get(id) ?? (await this.load(id, def))
    return model ? { model, def, colors: resolveColors(model, def) } : null
  }

  private withModel(id: string, cb: (model: VoxelModel, def: ModelDef) => void): void {
    const def = this.models.get(id)
    if (!def) {
      log.warn(`unknown model "${id}"`)
      return
    }
    const cached = this.ready.get(id)
    if (cached) return cb(cached, def)
    if (cached === null) return
    this.load(id, def).then((m) => {
      if (m) cb(m, def)
    })
  }

  private load(id: string, def: ModelDef): Promise<VoxelModel | null> {
    let p = this.parsed.get(id)
    if (!p) {
      p = (async () => {
        try {
          if (def.layers) return parseLayers(def.layers, def.palette)
          if (def.url) return parseVox(await (await fetch(def.url)).arrayBuffer())
          throw new Error('needs `layers` or `url`')
        } catch (e) {
          log.error(`model "${id}":`, e)
          return null
        }
      })().then((m) => {
        this.ready.set(id, m)
        return m
      })
      this.parsed.set(id, p)
    }
    return p
  }

  private mesh(id: string, model: VoxelModel, pivot: [number, number, number], palette: Record<string, string> | undefined, def: ModelDef): Mesh {
    const key = `${id}|${pivot.join(',')}|${palette ? JSON.stringify(palette) : ''}`
    let geo = this.geometries.get(key)
    if (!geo) {
      geo = toGeometry(buildVoxelGeometry(model, pivot), resolveColors(model, def, palette))
      this.geometries.set(key, geo)
    }
    const mesh = new Mesh(geo, this.material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  }
}

/** Palette overrides are keyed by the model's palette characters (e.g. recolor the shirt `t`). */
function resolveColors(model: VoxelModel, def: ModelDef, overrides?: Record<string, string>): string[] {
  if (!overrides || !def.layers) return model.colors
  const chars = Object.keys(def.palette)
  return model.colors.map((c, i) => (i === 0 ? c : (overrides[chars[i - 1]!] ?? c)))
}

function toGeometry(data: GeometryData, colors: string[]): BufferGeometry {
  const rgb = colors.map((c) => new Color(c))
  const col: number[] = []
  for (const ci of data.colorIndex) {
    const c = rgb[ci] ?? rgb[0]!
    col.push(c.r, c.g, c.b)
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(data.position, 3))
  geo.setAttribute('normal', new Float32BufferAttribute(data.normal, 3))
  geo.setAttribute('color', new Float32BufferAttribute(col, 3))
  geo.setIndex(data.index)
  geo.computeBoundingSphere()
  return geo
}
