import { BufferGeometry, Color, Float32BufferAttribute, Group, InstancedMesh, Mesh, MeshLambertMaterial, type Material, type Object3D, type Texture } from 'three'
import type { Registry } from '../registry/Registry'
import { createCharacterMaterial, createFaceUniforms, createFurMaterial, furUniforms, type FabricSlots, type FaceUniforms } from '../render/characterMaterial'
import { fabricUniforms, type FabricTextures } from '../render/fabric'
import { stylize } from '../render/style'
import type { ModelDef, RigDef } from './defs'
import { buildSmoothGeometry } from './smoothMesh'
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
  /** Round characters (`round` rigs): smooth parts, fur and drawn faces. Set from the engine config. */
  look: CharacterLook = { round: true, fur: true, faces: true, fabric: true, maxShells: 12, furFrom: 1.6, furFull: 5 }
  private characterMaterial = createCharacterMaterial()
  /** Fabric detail textures (set by the game once materials exist). */
  fabrics: FabricTextures | null = null
  private fabricMaterials = new Map<string, Material>()
  private furMaterials = new Map<string, Material>()
  /** Fur shell meshes alive in the scene (their shell count follows the zoom). */
  private furMeshes = new Set<InstancedMesh>()
  private furShells = -1
  private furFrame = 0
  /** Drawn faces alive in the scene (the faces plugin paints them). */
  private faceSlots = new Set<FaceSlot>()

  constructor(
    private models: Registry<ModelDef>,
    private rigs: Registry<RigDef>,
  ) {}

  /** Drop caches (content changed). Objects still showing an old geometry upload it again by themselves. */
  clear(): void {
    for (const geo of this.geometries.values()) geo.dispose()
    for (const m of this.furMaterials.values()) m.dispose()
    this.furMaterials.clear()
    for (const m of this.fabricMaterials.values()) m.dispose()
    this.fabricMaterials.clear()
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
      if (!mesh) return
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
    const round = rig.round && this.look.round ? rig.round : null
    root.userData.rig = id
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
      this.withModel(modelId, (model, def) => {
        if (round) {
          for (const o of this.roundPart(modelId, model, part.pivot, opts.palette, def, round)) g.add(o)
          return
        }
        const mesh = this.mesh(modelId, model, part.pivot, opts.palette, def)
        if (mesh) g.add(mesh)
      })
    }
    return root
  }

  /**
   * A part of a round rig: the smooth body (with a face where the model has one) and its fur shells.
   * A face replaces the painted eyes and mouth (`face.erase`), so the plugin drawing faces owns them.
   */
  private roundPart(
    id: string,
    model: VoxelModel,
    pivot: [number, number, number],
    palette: Record<string, string> | undefined,
    def: ModelDef,
    round: NonNullable<RigDef['round']>,
  ): Object3D[] {
    const face = this.look.faces ? def.face : undefined
    let colors = palette
    if (face && Object.keys(face.erase).length) {
      colors = { ...palette }
      for (const [from, to] of Object.entries(face.erase)) colors[from] = palette?.[to] ?? def.palette[to] ?? '#ff00ff'
    }
    const key = `round|${id}|${pivot.join(',')}|${colors ? JSON.stringify(colors) : ''}|${round.subdiv},${round.smooth},${round.iso}`
    let geo = this.geometries.get(key)
    let furGeo = this.geometries.get(key + '|fur')
    if (!geo) {
      const data = buildSmoothGeometry(model, pivot, round)
      geo = toGeometry(data, resolveColors(model, def, colors))
      // fur amount per vertex from the palette character it was painted with
      const chars = Object.keys(def.palette)
      const amount = data.colorIndex.map((ci) => def.fur?.keys[chars[ci - 1] ?? ''] ?? 0)
      geo.setAttribute('fur', new Float32BufferAttribute(amount, 1))
      // fabric slot weights per vertex (one-hot from the painted character; blends between)
      const fabricIds = def.fabric ? [...new Set(Object.values(def.fabric.keys))].slice(0, 3) : []
      if (fabricIds.length) {
        const w = new Float32Array(data.colorIndex.length * 3)
        data.colorIndex.forEach((ci, i) => {
          const slot = fabricIds.indexOf(def.fabric!.keys[chars[ci - 1] ?? ''] ?? '')
          if (slot >= 0) w[i * 3 + slot] = 1
        })
        geo.setAttribute('fabric', new Float32BufferAttribute(w, 3))
      }
      this.geometries.set(key, geo)
      // shells only over triangles that grow fur
      const idx: number[] = []
      for (let t = 0; t < data.index.length; t += 3) {
        const a = data.index[t]!
        const b = data.index[t + 1]!
        const c = data.index[t + 2]!
        if (amount[a]! + amount[b]! + amount[c]! > 0) idx.push(a, b, c)
      }
      if (idx.length) {
        furGeo = new BufferGeometry()
        for (const name of ['position', 'normal', 'color', 'fur']) furGeo.setAttribute(name, geo.getAttribute(name))
        furGeo.setIndex(idx)
        furGeo.computeBoundingSphere()
        this.geometries.set(key + '|fur', furGeo)
      }
    }
    if (!geo.index!.count) return []
    const faceUniforms: FaceUniforms | undefined = face
      ? createFaceUniforms(face.center[0] - pivot[0], face.center[1] - pivot[1], face.size[0], face.size[1], face.front - pivot[2] - 1.5)
      : undefined
    const fabric = this.fabricSlots(def, geo)
    let bodyMat: Material = this.characterMaterial
    if (faceUniforms) bodyMat = createCharacterMaterial(faceUniforms, fabric)
    else if (fabric) {
      bodyMat = this.fabricMaterials.get(id) ?? createCharacterMaterial(undefined, fabric)
      this.fabricMaterials.set(id, bodyMat)
    }
    const body = new Mesh(geo, bodyMat)
    body.castShadow = true
    body.receiveShadow = true
    if (face && faceUniforms) {
      const slot: FaceSlot = {
        mesh: body,
        face,
        model: id,
        get root() {
          let o: Object3D = body
          while (o.parent && !o.userData.rig) o = o.parent
          return o
        },
        picture(tex) {
          faceUniforms.uFace.value = tex
          faceUniforms.uFaceOn.value = tex ? 1 : 0
        },
      }
      body.userData.face = slot
      this.faceSlots.add(slot)
    }
    const out: Object3D[] = [body]
    if (furGeo && def.fur && this.look.fur) {
      let mat = faceUniforms ? undefined : this.furMaterials.get(id)
      if (!mat) {
        mat = createFurMaterial(def.fur, faceUniforms)
        if (!faceUniforms) this.furMaterials.set(id, mat)
      }
      const shells = new InstancedMesh(furGeo, mat, this.look.maxShells)
      shells.count = Math.max(0, this.furShells)
      shells.visible = this.furShells > 0
      shells.frustumCulled = false
      shells.userData.fur = true
      this.furMeshes.add(shells)
      out.push(shells)
    }
    return out
  }

  /** Uniforms of a part's fabric materials (null: no fabric, or the look turned it off). */
  private fabricSlots(def: ModelDef, geo: BufferGeometry): FabricSlots | undefined {
    const f = def.fabric
    if (!f || !this.fabrics || !this.look.fabric || !geo.getAttribute('fabric')) return undefined
    const ids = [...new Set(Object.values(f.keys))].slice(0, 3)
    const tex = (i: number) => this.fabrics!.uniform(ids[i] ?? ids[0]!)
    return { uMat0: tex(0), uMat1: tex(1), uMat2: tex(2), uMatScale: { value: 1 / f.tile }, uMatStrength: { value: f.strength } }
  }

  /** Every drawn face in the scene (rig heads with a `face`), for the plugin that paints them. */
  eachFace(fn: (slot: FaceSlot) => void): void {
    const prune = this.furFrame % 60 === 30
    for (const s of this.faceSlots) {
      if (prune && !inScene(s.mesh)) {
        this.faceSlots.delete(s)
        continue
      }
      fn(s)
    }
  }

  /**
   * Once a frame: how many fur shells to draw for this many screen pixels per voxel. Fur grows in
   * smoothly as the camera comes closer and disappears far away (where it would only shimmer).
   */
  updateFur(pixelsPerVoxel: number): void {
    const l = this.look
    const t = l.fur ? smoothstep(l.furFrom, l.furFull, pixelsPerVoxel) : 0
    const shells = t > 0 ? Math.max(3, Math.round(l.maxShells * t)) : 0
    furUniforms.uFurFade.value = t
    furUniforms.uFurShells.value = shells
    // fabric weave fades in with the fur; its texture is as fine as a tile shows on screen
    const near = l.fabric ? smoothstep(l.furFrom, l.furFull, pixelsPerVoxel) : 0
    fabricUniforms.uMatFade.value = near
    if (this.fabrics && near > 0) this.fabrics.setLevel(Math.min(256, Math.max(32, 2 ** Math.ceil(Math.log2(Math.max(1, pixelsPerVoxel * 4))))))
    const prune = ++this.furFrame % 60 === 0
    if (shells === this.furShells && !prune) return
    this.furShells = shells
    for (const m of this.furMeshes) {
      if (prune && !inScene(m)) {
        this.furMeshes.delete(m)
        continue
      }
      m.count = Math.min(shells, m.instanceMatrix.count)
      m.visible = shells > 0
    }
  }

  /** Parsed model + its definition (for icons, tools, previews). */
  async getModel(id: string, palette?: Record<string, string>): Promise<{ model: VoxelModel; def: ModelDef; colors: string[] } | null> {
    const def = this.models.get(id)
    if (!def) return null
    const model = this.ready.get(id) ?? (await this.load(id, def))
    return model ? { model, def, colors: resolveColors(model, def, palette) } : null
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

  /** Geometry of a voxel model (voxel units), its scale and a key naming this exact look — for instancing. */
  voxelGeometry(id: string, palette: Record<string, string> | undefined, cb: (geo: BufferGeometry, scale: number, key: string) => void): void {
    this.withModel(id, (model, def) => {
      const { geo, key } = this.geometry(id, model, def.pivot ?? defaultPivot(model), palette, def)
      if (geo.index!.count) cb(geo, def.scale, key)
    })
  }

  /** Every part of a rig standing still: geometry, scale, key and where it goes (world units) — for instancing. */
  rigGeometry(
    id: string,
    opts: { scale?: number; palette?: Record<string, string>; parts?: Record<string, string> },
    cb: (geo: BufferGeometry, scale: number, key: string, at: [number, number, number]) => void,
  ): void {
    const rig = this.rigs.get(id)
    if (!rig) return void log.warn(`unknown rig "${id}"`)
    const scale = opts.scale ?? rig.scale
    for (const part of rig.parts) {
      const modelId = opts.parts?.[part.name] ?? part.model
      this.withModel(modelId, (model, def) => {
        const { geo, key } = this.geometry(modelId, model, part.pivot, opts.palette, def)
        if (geo.index!.count) cb(geo, scale, key, [part.at[0] * scale, part.at[1] * scale, part.at[2] * scale])
      })
    }
  }

  private geometry(id: string, model: VoxelModel, pivot: [number, number, number], palette: Record<string, string> | undefined, def: ModelDef) {
    const key = `${id}|${pivot.join(',')}|${palette ? JSON.stringify(palette) : ''}`
    let geo = this.geometries.get(key)
    if (!geo) {
      // faces merge up to one block: longer quads would cut corners on the curved world
      const maxMerge = Math.max(1, Math.round(1 / def.scale))
      geo = toGeometry(buildVoxelGeometry(model, pivot, maxMerge), resolveColors(model, def, palette))
      this.geometries.set(key, geo)
    }
    return { geo, key }
  }

  /** Null for empty models (a tree's missing fruit): nothing to draw. */
  private mesh(id: string, model: VoxelModel, pivot: [number, number, number], palette: Record<string, string> | undefined, def: ModelDef): Mesh | null {
    const { geo } = this.geometry(id, model, pivot, palette, def)
    if (!geo.index!.count) return null
    const mesh = new Mesh(geo, this.material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  }
}

/** A drawn face on a round rig's head. */
export interface FaceSlot {
  /** The head's body mesh (its world matrix places the face). */
  readonly mesh: Mesh
  /** The rig object the head belongs to (an entity's view, or a plugin's rig model). */
  readonly root: Object3D
  readonly face: NonNullable<ModelDef['face']>
  /** Model id of the head. */
  readonly model: string
  /** Show a picture on the face (null: none — the head is bare). */
  picture(texture: Texture | null): void
}

export interface CharacterLook {
  round: boolean
  fur: boolean
  faces: boolean
  fabric: boolean
  maxShells: number
  /** Fur starts showing at this many screen pixels per voxel… */
  furFrom: number
  /** …and is full grown at this many. */
  furFull: number
}

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / Math.max(1e-6, b - a)))
  return t * t * (3 - 2 * t)
}

/** Still part of a scene (not removed with its entity)? */
function inScene(o: Object3D): boolean {
  let p: Object3D | null = o
  while (p.parent) p = p.parent
  return (p as { isScene?: boolean }).isScene === true
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
