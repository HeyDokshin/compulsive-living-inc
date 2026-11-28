import {
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshLambertMaterial,
  SRGBColorSpace,
  type Material,
  type Object3D,
  type Texture,
} from 'three'
import type { Registry } from '../registry/Registry'
import {
  createCharacterMaterial,
  createFaceUniforms,
  createFurMaterial,
  furUniforms,
  type FabricSlots,
  type FaceUniforms,
  type PatternUniforms,
} from '../render/characterMaterial'
import type { ModelSpec } from '../types'
import { fabricUniforms, type FabricTextures } from '../render/fabric'
import { stylize } from '../render/style'
import type { ModelDef, RigDef } from './defs'
import { buildThing, flatAxis, flatPicture, surfaceFor, type FlatPicture, type ModelBuild } from './thingMesh'
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
  look: CharacterLook = { round: true, fur: true, faces: true, fabric: true, maxShells: 12, furFrom: 2.4, furFull: 6 }
  /** How things are built from voxels (`render.models`). Set from the engine config. */
  build: ModelBuild = { style: 'auto', bevel: 0.45, maxBoxes: 36, merge: 70 }
  private characterMaterial = createCharacterMaterial()
  /** Fabric detail textures (set by the game once materials exist). */
  fabrics: FabricTextures | null = null
  private fabricMaterials = new Map<string, Material>()
  /** Materials picked from a model's colors (null: none). */
  private autoFabric = new WeakMap<ModelDef, NonNullable<ModelDef['fabric']> | null>()
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
  createVoxel(id: string, opts: { scale?: number; palette?: Record<string, string>; pattern?: Pattern } = {}): Object3D {
    const group = new Group()
    group.name = id
    this.withModel(id, (model, def) => {
      const mesh = this.mesh(id, model, def.pivot ?? defaultPivot(model), opts.palette, def, opts.pattern)
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
      this.setFabric(geo, data.colorIndex, model, def)
      this.geometries.set(key, geo)
      // Shells: a coarser copy of the same surface (fluff hides the difference; ~half the
      // triangles, drawn many times over), only where fur grows.
      if (amount.some((a) => a > 0)) {
        const coarse = round.subdiv > 2 ? buildSmoothGeometry(model, pivot, { ...round, subdiv: 2 }) : data
        const shellGeo = coarse === data ? geo : toGeometry(coarse, resolveColors(model, def, colors))
        const shellFur = coarse === data ? amount : coarse.colorIndex.map((ci) => def.fur?.keys[chars[ci - 1] ?? ''] ?? 0)
        const idx: number[] = []
        for (let t = 0; t < coarse.index.length; t += 3) {
          const a = coarse.index[t]!
          const b = coarse.index[t + 1]!
          const c = coarse.index[t + 2]!
          if (shellFur[a]! + shellFur[b]! + shellFur[c]! > 0) idx.push(a, b, c)
        }
        if (idx.length) {
          furGeo = new BufferGeometry()
          for (const name of ['position', 'normal', 'color']) furGeo.setAttribute(name, shellGeo.getAttribute(name))
          furGeo.setAttribute('fur', new Float32BufferAttribute(shellFur, 1))
          furGeo.setIndex(idx)
          furGeo.computeBoundingSphere()
          this.geometries.set(key + '|fur', furGeo)
        }
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
        fadeFrom(tex, mix) {
          faceUniforms.uFacePrev.value = tex
          faceUniforms.uFaceMix.value = tex ? mix : 1
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

  /**
   * The model's own `fabric`, or one chosen from its colors: every model gets a generated surface —
   * wood grain on browns, stone on greys, plaster on whites, brush strokes on paint, leaves on greens.
   */
  private fabricOf(model: VoxelModel, def: ModelDef): NonNullable<ModelDef['fabric']> | undefined {
    if (def.fabric) return def.fabric
    // heads with drawn faces keep clean skin
    if (!this.look.fabric || !def.layers || def.face) return undefined
    let f = this.autoFabric.get(def)
    if (f === undefined) {
      const chars = Object.keys(def.palette)
      const count = new Map<string, number>()
      for (const ci of model.voxels) if (ci) count.set(chars[ci - 1] ?? '', (count.get(chars[ci - 1] ?? '') ?? 0) + 1)
      const keys: Record<string, string> = {}
      const uses = new Map<string, number>()
      for (const c of chars) {
        const m = surfaceFor(def.palette[c]!)
        keys[c] = m
        uses.set(m, (uses.get(m) ?? 0) + (count.get(c) ?? 0))
      }
      // at most three materials: the most used ones; the rest stay plain
      const top = [...uses]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([m]) => m)
      for (const c of chars) if (!top.includes(keys[c]!)) delete keys[c]
      f = Object.keys(keys).length ? { keys, tile: 6, strength: 0.5, always: true } : null
      this.autoFabric.set(def, f)
    }
    return f ?? undefined
  }

  /** Fabric slot weights per vertex (one-hot from the painted character; blends between). */
  private setFabric(geo: BufferGeometry, colorIndex: ArrayLike<number>, model: VoxelModel, def: ModelDef): void {
    const f = this.fabricOf(model, def)
    if (!f) return
    const chars = Object.keys(def.palette)
    const ids = [...new Set(Object.values(f.keys))].slice(0, 3)
    const w = new Float32Array(colorIndex.length * 3)
    for (let i = 0; i < colorIndex.length; i++) {
      const slot = ids.indexOf(f.keys[chars[colorIndex[i]! - 1] ?? ''] ?? '')
      if (slot >= 0) w[i * 3 + slot] = 1
    }
    geo.setAttribute('fabric', new Float32BufferAttribute(w, 3))
    geo.userData.fabric = f
  }

  /** Uniforms of a part's fabric materials (null: no fabric, or the look turned it off). */
  private fabricSlots(def: ModelDef, geo: BufferGeometry): FabricSlots | undefined {
    const f = (geo.userData.fabric as ModelDef['fabric']) ?? def.fabric
    if (!f || !this.fabrics || !this.look.fabric || !geo.getAttribute('fabric')) return undefined
    const ids = [...new Set(Object.values(f.keys))].slice(0, 3)
    const tex = (i: number) => this.fabrics!.uniform(ids[i] ?? ids[0]!)
    return {
      uMat0: tex(0),
      uMat1: tex(1),
      uMat2: tex(2),
      uMatScale: { value: 1 / f.tile },
      uMatStrength: { value: f.strength },
      uMatAlways: { value: f.always ? 1 : 0 },
    }
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
  voxelGeometry(
    id: string,
    palette: Record<string, string> | undefined,
    cb: (geo: BufferGeometry, scale: number, key: string, material: Material) => void,
    pattern?: Pattern,
  ): void {
    this.withModel(id, (model, def) => {
      const { geo, key } = this.geometry(id, model, def.pivot ?? defaultPivot(model), palette, def)
      if (geo.index!.count) cb(geo, def.scale, pattern ? `${key}|${JSON.stringify(pattern)}` : key, this.materialOf(id, def, geo, pattern))
    })
  }

  /** Every part of a rig standing still: geometry, scale, key and where it goes (world units) — for instancing. */
  rigGeometry(
    id: string,
    opts: { scale?: number; palette?: Record<string, string>; parts?: Record<string, string> },
    cb: (geo: BufferGeometry, scale: number, key: string, at: [number, number, number], material: Material) => void,
  ): void {
    const rig = this.rigs.get(id)
    if (!rig) return void log.warn(`unknown rig "${id}"`)
    const scale = opts.scale ?? rig.scale
    for (const part of rig.parts) {
      const modelId = opts.parts?.[part.name] ?? part.model
      this.withModel(modelId, (model, def) => {
        const { geo, key } = this.geometry(modelId, model, part.pivot, opts.palette, def, rig.round)
        if (geo.index!.count) cb(geo, scale, key, [part.at[0] * scale, part.at[1] * scale, part.at[2] * scale], this.materialOf(modelId, def, geo))
      })
    }
  }

  /** Plain voxel color, or the weave / leaves of the model's `fabric` (shown at every distance unless it is clothing). */
  private materialOf(id: string, def: ModelDef, geo: BufferGeometry, pattern?: Pattern): Material {
    const fabric = this.fabricSlots(def, geo)
    const pat = pattern && this.fabrics ? this.patternUniforms(pattern) : undefined
    const map = geo.userData.map as Texture | undefined
    if (!fabric && !pat && !map) return this.material
    // a flat thing's picture is its own (each palette has one): its material too
    const key = `${id}${map ? `|${geo.uuid}` : ''}${pat ? `|${JSON.stringify(pattern)}` : ''}`
    let m = this.fabricMaterials.get(key)
    if (!m) {
      const mat = createCharacterMaterial(undefined, fabric, pat)
      if (map) {
        mat.map = map
        mat.alphaTest = 0.5
      }
      this.fabricMaterials.set(key, (m = mat))
    }
    return m
  }

  private patternUniforms(p: Pattern): PatternUniforms {
    const c = new Color(p.color)
    return { uPat: this.fabrics!.mask(p.material), uPatColor: { value: [c.r, c.g, c.b] }, uPatScale: { value: 1 / p.tile } }
  }

  private geometry(
    id: string,
    model: VoxelModel,
    pivot: [number, number, number],
    palette: Record<string, string> | undefined,
    def: ModelDef,
    rigRound?: RigDef['round'],
  ) {
    // soft and round (low-poly: a sample per voxel) where the model or its rig asks for it
    const round = this.look.round ? (def.round ?? rigRound) : undefined
    const b = this.build
    const style = round ? 'round' : b.style === 'blocks' ? 'blocks' : def.style
    const key = `${id}|${pivot.join(',')}|${palette ? JSON.stringify(palette) : ''}|${round ? JSON.stringify(round) : `${style},${b.bevel},${b.maxBoxes},${b.merge}`}`
    let geo = this.geometries.get(key)
    if (!geo && round) {
      const data = buildSmoothGeometry(model, pivot, { ...round, keep: round.keep ?? 0.62 })
      geo = toGeometry(data, resolveColors(model, def, palette))
      this.setFabric(geo, data.colorIndex, model, def)
      this.geometries.set(key, geo)
    }
    if (!geo && style === 'auto') {
      // flat things (rugs, pictures, wall clocks): one smooth picture with a soft outline
      const axis = flatAxis(model)
      if (axis) {
        const pic = flatPicture(model, axis, resolveColors(model, def, palette))
        geo = flatGeometry(model, pivot, axis)
        geo.userData.map = pictureTexture(pic)
        // knit on rugs, canvas on pictures, unless the model has its own
        const chars = Object.keys(def.palette)
        const fabric = def.fabric ?? {
          keys: Object.fromEntries(chars.map((c) => [c, axis === 'y' ? 'core:knit' : 'core:linen'])),
          tile: 4,
          strength: 0.55,
          always: true,
        }
        this.setFabric(geo, [pic.main, pic.main, pic.main, pic.main], model, { ...def, fabric })
        this.geometries.set(key, geo)
      }
    }
    if (!geo && (style === 'auto' || style === 'bevel')) {
      const data = buildThing(model, pivot, { style, scale: def.scale, parts: def.parts, palette: def.palette }, b)
      geo = toGeometry(data, resolveColors(model, def, palette))
      this.setFabric(geo, data.colorIndex, model, def)
      this.geometries.set(key, geo)
    }
    if (!geo) {
      // faces merge up to one block: longer quads would cut corners on the curved world
      const maxMerge = Math.max(1, Math.round(1 / def.scale))
      const data = buildVoxelGeometry(model, pivot, maxMerge)
      geo = toGeometry(data, resolveColors(model, def, palette))
      this.setFabric(geo, data.colorIndex, model, def)
      this.geometries.set(key, geo)
    }
    return { geo, key }
  }

  /** Null for empty models (a tree's missing fruit): nothing to draw. */
  private mesh(
    id: string,
    model: VoxelModel,
    pivot: [number, number, number],
    palette: Record<string, string> | undefined,
    def: ModelDef,
    pattern?: Pattern,
  ): Mesh | null {
    const { geo } = this.geometry(id, model, pivot, palette, def)
    if (!geo.index!.count) return null
    const mesh = new Mesh(geo, this.materialOf(id, def, geo, pattern))
    mesh.castShadow = !geo.userData.map // a flat picture's shadow would be its square
    mesh.receiveShadow = true
    return mesh
  }
}

/** A rare pattern over a model (see ModelSpec.pattern). */
type Pattern = NonNullable<ModelSpec['pattern']>

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
  /** Fade from another picture: `mix` 0 shows it, 1 only the current one. */
  fadeFrom(texture: Texture | null, mix: number): void
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

/** One quad over a flat thing's face (voxel units, relative to the pivot), white: the picture colors it. */
function flatGeometry(model: VoxelModel, pivot: [number, number, number], axis: 'y' | 'z'): BufferGeometry {
  const [sx, sy, sz] = model.size
  const [px, py, pz] = pivot
  const geo = new BufferGeometry()
  const pos =
    axis === 'y'
      ? [0, sy, sz, sx, sy, sz, sx, sy, 0, 0, sy, 0] // seen from above; the back edge (z = 0) is the picture's top
      : [0, 0, sz, sx, 0, sz, sx, sy, sz, 0, sy, sz] // seen from the front
  for (let i = 0; i < 12; i += 3) {
    pos[i] = pos[i]! - px
    pos[i + 1] = pos[i + 1]! - py
    pos[i + 2] = pos[i + 2]! - pz
  }
  const n = axis === 'y' ? [0, 1, 0] : [0, 0, 1]
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new Float32BufferAttribute([...n, ...n, ...n, ...n], 3))
  geo.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
  geo.setAttribute('color', new Float32BufferAttribute(new Array(12).fill(1), 3))
  geo.setIndex([0, 1, 2, 0, 2, 3])
  geo.computeBoundingSphere()
  return geo
}

/** A flat thing's picture, scaled up smoothly (soft colors, a smooth outline through the alpha test). */
function pictureTexture(pic: FlatPicture): Texture {
  const k = 8
  const small = document.createElement('canvas')
  small.width = pic.w
  small.height = pic.h
  small.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pic.rgba), pic.w, pic.h), 0, 0)
  const big = document.createElement('canvas')
  big.width = pic.w * k
  big.height = pic.h * k
  const g = big.getContext('2d')!
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  g.drawImage(small, 0, 0, big.width, big.height)
  // the outline from a blurred mask: round where the voxels make steps (the alpha test cuts at half)
  const mask = document.createElement('canvas')
  mask.width = big.width
  mask.height = big.height
  const mg = mask.getContext('2d')!
  mg.filter = `blur(${k * 0.55}px)`
  mg.drawImage(small, 0, 0, big.width, big.height)
  g.globalCompositeOperation = 'destination-in'
  g.drawImage(mask, 0, 0)
  g.globalCompositeOperation = 'source-over'
  const tex = new CanvasTexture(big)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 4
  return tex
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

export { surfaceFor } from './thingMesh'
