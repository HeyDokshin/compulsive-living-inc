import type { VoxelWorld } from '../world/VoxelWorld'
import type { Entities } from '../ecs/Entities'
import type { Entity } from '../types'
import type { SavedEntity, SavedWorld } from './format'

/** Run-length encode: [value, run, value, run, …]. */
export function rleEncode(data: ArrayLike<number>): Uint32Array {
  const out: number[] = []
  let i = 0
  while (i < data.length) {
    const v = data[i]!
    let run = 1
    while (i + run < data.length && data[i + run] === v) run++
    out.push(v, run)
    i += run
  }
  return new Uint32Array(out)
}

export function rleDecode(rle: ArrayLike<number>, out: { length: number; [i: number]: number }): void {
  let o = 0
  for (let i = 0; i + 1 < rle.length; i += 2) {
    const v = rle[i]!
    const run = rle[i + 1]!
    for (let k = 0; k < run && o < out.length; k++) out[o++] = v
  }
  if (o !== out.length) throw new Error(`voxel data size mismatch: decoded ${o}, expected ${out.length}`)
}

/** Snapshot every voxel (all chunks back to back) plus the palette that gives the numbers meaning. */
export function encodeWorld(w: VoxelWorld, config: Record<string, unknown>): SavedWorld {
  const total = w.chunks.reduce((n, c) => n + c.data.length, 0)
  const all = new Uint16Array(total)
  let o = 0
  for (const c of w.chunks) {
    all.set(c.data, o)
    o += c.data.length
  }
  return {
    config: structuredClone(config),
    palette: w.palette.entries(),
    chunksX: w.chunksX,
    chunksZ: w.chunksZ,
    height: w.height,
    voxels: rleEncode(all),
  }
}

/**
 * Write saved voxels into a world of the same shape. Saved block numbers are remapped through
 * ids to the current palette, so saves survive mods being added or removed.
 */
export function decodeWorld(saved: SavedWorld, w: VoxelWorld): void {
  if (w.chunksX !== saved.chunksX || w.chunksZ !== saved.chunksZ || w.height !== saved.height) {
    w.reset(saved.chunksX, saved.chunksZ, saved.height)
  }
  const total = w.chunks.reduce((n, c) => n + c.data.length, 0)
  const all = new Uint16Array(total)
  rleDecode(saved.voxels, all)
  const remap = saved.palette.map((id) => (id === 'air' ? 0 : w.palette.num(id)))
  let o = 0
  for (const c of w.chunks) {
    for (let i = 0; i < c.data.length; i++) c.data[i] = remap[all[o + i]!] ?? 0
    o += c.data.length
    c.version++
  }
  w.markAllDirty()
}

/** Components worth saving: everything except runtime-only ones (three.js views…) and non-cloneables. */
export function serializeEntities(entities: Entities): SavedEntity[] {
  const runtime = new Set(
    entities
      .componentDefs()
      .filter((d) => !d.persistent)
      .map((d) => d.name),
  )
  const out: SavedEntity[] = []
  for (const e of entities.world.entities) {
    const components: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(e as Record<string, unknown>)) {
      if (runtime.has(k) || v === undefined) continue
      try {
        components[k] = structuredClone(v)
      } catch {
        // not serializable (e.g. a function) — treat as runtime
      }
    }
    if (Object.keys(components).length) out.push({ components })
  }
  return out
}

/**
 * Spawn saved entities as they were (uids kept). Unknown components are restored as-is. Returns the
 * ones that can't be spawned (a component changed shape): they stay out but must not be lost.
 */
export function restoreEntities(saved: SavedEntity[], entities: Entities): SavedEntity[] {
  const failed: SavedEntity[] = []
  for (const s of saved) {
    try {
      entities.spawn(structuredClone(s.components) as Entity)
    } catch (e) {
      console.error('[save] an entity could not be restored:', e)
      failed.push(s)
    }
  }
  return failed
}

/** Save → portable JSON text (typed arrays become base64). */
export function saveToJson(data: unknown): string {
  return JSON.stringify(data, (_k, v) => {
    if (v instanceof Uint32Array) {
      const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
      let bin = ''
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return { $u32: btoa(bin) }
    }
    return v
  })
}

export function saveFromJson<T>(text: string): T {
  return JSON.parse(text, (_k, v) => {
    if (v && typeof v === 'object' && typeof v.$u32 === 'string') {
      const bin = atob(v.$u32)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return new Uint32Array(bytes.buffer)
    }
    return v
  }) as T
}
