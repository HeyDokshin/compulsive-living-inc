import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  type MeshLambertMaterial,
} from 'three'
import type { VoxelWorld } from '../world/VoxelWorld'
import type { MesherPool } from '../world/mesher/MesherPool'
import type { MeshBuffers, TintParams } from '../world/mesher/mesher'
import type { RoundParams } from '../world/mesher/roundMesher'
import type { BlockAtlas } from './BlockAtlas'
import { createTerrainMaterial, createWaterMaterial } from './terrainMaterial'
import { createVoxelMaterial } from './voxelMaterial'

interface ChunkMeshes {
  opaque?: Mesh
  transparent?: Mesh
}

/** Keeps one opaque + one transparent mesh per chunk in sync with the world, meshing in workers. */
export class ChunkRenderer {
  readonly group = new Group()
  readonly opaqueMaterial: MeshLambertMaterial
  readonly transparentMaterial: MeshLambertMaterial
  /** The rounded island's ground and water (style 'round'). */
  readonly roundMaterial: MeshLambertMaterial = createTerrainMaterial()
  readonly roundWaterMaterial: MeshLambertMaterial = createWaterMaterial(0.8)
  /** Rounded island (no pixel textures) when set; blocks otherwise. Change → call reset(). */
  round: RoundParams | null = null
  aoCurve: [number, number, number, number] = [0.5, 0.68, 0.84, 1]
  /** See MeshInput.maxMerge. Change → call remeshAll(). */
  maxMerge = Infinity
  /** Lawn color patches (origin is filled per chunk). Change → call remeshAll(). */
  tint?: Omit<TintParams, 'origin'>
  private meshes = new Map<number, ChunkMeshes>()
  private inFlight = new Set<number>()
  private epoch = 0
  private borders?: LineSegments
  /** Chunks meshed since start (debug stat). */
  meshedCount = 0
  private focus = { x: 0, z: 0 }
  /** Which chunks may be drawn (interiors hide the island and vice versa). */
  isVisible: (cx: number, cz: number) => boolean = () => true
  /** Can a ball show up in the picture? (set by the Renderer; knows about the curved world) */
  inView: (x: number, y: number, z: number, r: number) => boolean = () => true

  constructor(
    private world: VoxelWorld,
    private atlas: BlockAtlas,
    private pool: MesherPool,
  ) {
    this.group.name = 'chunks'
    this.opaqueMaterial = createVoxelMaterial(atlas.texture)
    this.transparentMaterial = createVoxelMaterial(atlas.texture, { transparent: true, opacity: 0.78 })
  }

  set waterOpacity(v: number) {
    this.transparentMaterial.opacity = v
    this.roundWaterMaterial.opacity = Math.min(1, v + 0.08)
  }

  /** Materials for the current style. */
  get ground(): MeshLambertMaterial {
    return this.round ? this.roundMaterial : this.opaqueMaterial
  }

  get water(): MeshLambertMaterial {
    return this.round ? this.roundWaterMaterial : this.transparentMaterial
  }

  /** Forget all meshes (world was recreated). */
  reset(): void {
    this.epoch++
    for (const m of this.meshes.values()) this.disposeChunk(m)
    this.meshes.clear()
    this.inFlight.clear()
    this.world.markAllDirty()
    if (this.borders) this.setBorders(true)
  }

  /** Rebuild every chunk mesh, keeping the old meshes on screen until the new ones arrive. */
  remeshAll(): void {
    this.world.markAllDirty()
  }

  /** Send dirty chunks to the mesher pool, nearest to `focus` first. */
  update(focusX = this.focus.x, focusZ = this.focus.z): void {
    this.focus.x = focusX
    this.focus.z = focusZ
    const world = this.world
    if (!world.dirty.size) return
    const free = this.pool.capacity - this.inFlight.size
    if (free <= 0) return
    const candidates = [...world.dirty].filter((ci) => !this.inFlight.has(ci) && ci < world.chunks.length)
    candidates.sort((a, b) => dist(world, a, focusX, focusZ) - dist(world, b, focusX, focusZ))
    for (const ci of candidates.slice(0, free)) {
      world.dirty.delete(ci)
      this.inFlight.add(ci)
      const epoch = this.epoch
      const table = this.atlas.table
      const tint = this.tint ? { ...this.tint, origin: [world.chunks[ci]!.cx * 16, world.chunks[ci]!.cz * 16] as [number, number] } : undefined
      const round = this.round
      // blocks of the neighbours the blur and the normals read (and that make them remesh when edited)
      const pad = round ? Math.ceil((round.smoothAcross + 2) / round.subdiv) + 1 : 1
      world.neighbourReach = pad
      this.pool
        .mesh(
          round
            ? {
                mode: 'round',
                vol: world.paddedVolume(ci, undefined, pad),
                sx: 16,
                sy: world.height,
                sz: 16,
                pad,
                round,
                tint,
                table: {
                  kind: table.kind.slice(),
                  tiles: new Float32Array(0),
                  liquid: table.liquid?.slice(),
                  tint: table.tint?.slice(),
                  topColor: table.topColor?.slice(),
                  sideColor: table.sideColor?.slice(),
                  detailTop: table.detailTop?.slice(),
                  detailSide: table.detailSide?.slice(),
                },
              }
            : {
                vol: world.paddedVolume(ci),
                sx: 16,
                sy: world.height,
                sz: 16,
                table: { kind: table.kind.slice(), tiles: table.tiles.slice(), liquid: table.liquid?.slice(), tint: table.tint?.slice() },
                tint,
                aoCurve: this.aoCurve,
                maxMerge: this.maxMerge,
              },
        )
        .then((out) => {
          if (epoch !== this.epoch) return // reset() already forgot this job
          this.inFlight.delete(ci)
          const c = world.chunks[ci]!
          const meshes = this.meshes.get(ci) ?? {}
          meshes.opaque = this.replace(meshes.opaque, out.opaque, this.ground, c.cx, c.cz)
          meshes.transparent = this.replace(meshes.transparent, out.transparent, this.water, c.cx, c.cz)
          this.meshes.set(ci, meshes)
          this.meshedCount++
          // Keep the pipeline full without waiting for the next frame (matters in background tabs).
          this.update()
        })
        .catch((e) => {
          if (epoch !== this.epoch) return
          this.inFlight.delete(ci)
          world.dirty.add(ci) // retry on the next update
          console.error('[chunks] meshing failed', e)
        })
    }
  }

  /** Every frame: show the chunks that are allowed and in the picture. */
  cull(): void {
    const half = this.world.height / 2
    const r = Math.hypot(8, half, 8)
    for (const [ci, m] of this.meshes) {
      const c = this.world.chunks[ci]
      if (!c) continue
      const v = this.isVisible(c.cx, c.cz) && this.inView(c.cx * 16 + 8, half, c.cz * 16 + 8, r)
      if (m.opaque) m.opaque.visible = v
      if (m.transparent) m.transparent.visible = v
    }
  }

  get pending(): number {
    return this.world.dirty.size + this.inFlight.size
  }

  setBorders(show: boolean): void {
    if (this.borders) {
      this.borders.removeFromParent()
      this.borders.geometry.dispose()
      this.borders = undefined
    }
    if (!show) return
    const box = new EdgesGeometry(new BoxGeometry(16, this.world.height, 16))
    const pos: number[] = []
    const src = box.getAttribute('position')
    for (const c of this.world.chunks) {
      for (let i = 0; i < src.count; i++) {
        pos.push(src.getX(i) + c.cx * 16 + 8, src.getY(i) + this.world.height / 2, src.getZ(i) + c.cz * 16 + 8)
      }
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
    this.borders = new LineSegments(geo, new LineBasicMaterial({ color: 0xffdd55, transparent: true, opacity: 0.5 }))
    this.group.add(this.borders)
  }

  stats(): { chunks: number; triangles: number } {
    let triangles = 0
    for (const m of this.meshes.values()) {
      for (const mesh of [m.opaque, m.transparent]) if (mesh) triangles += (mesh.geometry.index?.count ?? 0) / 3
    }
    return { chunks: this.meshes.size, triangles }
  }

  dispose(): void {
    this.reset()
    this.opaqueMaterial.dispose()
    this.transparentMaterial.dispose()
    this.roundMaterial.dispose()
    this.roundWaterMaterial.dispose()
    this.setBorders(false)
  }

  private replace(old: Mesh | undefined, buf: MeshBuffers, mat: MeshLambertMaterial, cx: number, cz: number): Mesh | undefined {
    if (old) {
      old.removeFromParent()
      old.geometry.dispose()
    }
    if (!buf.index.length) return undefined
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(buf.position, 3))
    geo.setAttribute('normal', new BufferAttribute(buf.normal, 3))
    if (buf.uv.length) geo.setAttribute('uv', new BufferAttribute(buf.uv, 2))
    if (buf.tile.length) geo.setAttribute('tile', new BufferAttribute(buf.tile, 4))
    if (buf.detail?.length) geo.setAttribute('detail', new BufferAttribute(buf.detail, 1))
    geo.setAttribute('color', new BufferAttribute(buf.color, 3))
    geo.setIndex(new BufferAttribute(buf.index, 1))
    geo.computeBoundingSphere()
    const mesh = new Mesh(geo, mat)
    mesh.position.set(cx * 16, 0, cz * 16)
    mesh.visible = this.isVisible(cx, cz)
    mesh.frustumCulled = false // see cull()
    mesh.castShadow = mat === this.opaqueMaterial || mat === this.roundMaterial
    mesh.receiveShadow = true
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
    this.group.add(mesh)
    return mesh
  }

  private disposeChunk(m: ChunkMeshes): void {
    for (const mesh of [m.opaque, m.transparent]) {
      if (!mesh) continue
      mesh.removeFromParent()
      mesh.geometry.dispose()
    }
  }
}

function dist(world: VoxelWorld, ci: number, x: number, z: number): number {
  const c = world.chunks[ci]
  if (!c) return Infinity
  return Math.hypot(c.cx * 16 + 8 - x, c.cz * 16 + 8 - z)
}
