import JSON5 from 'json5'
import type { RegistryHub } from '../registry/RegistryHub'
import type { RegistryEntry } from '../registry/Registry'
import { deepMerge, isPlainObject } from '../util/objects'
import { createLogger } from '../util/log'

const log = createLogger('content')

/**
 * Data packs: `content/<pack>/<registry>.json5`.
 * The file name picks the registry: `blocks.json5` → `blocks`, `fishing.baits.json5` → `fishing:baits`.
 *
 * File format — either an array of entries, or:
 *   { entries: [...], tags: { 'core:ground': ['core:grass', ...] }, patch: { 'core:apple': { price: 200 } } }
 * `patch` changes entries of other packs: objects merge, everything else is replaced.
 */
export class ContentLoader {
  private files: Record<string, string> = {}
  private assets: Record<string, string> = {}
  private loadedPacks = new Set<string>()
  /** Something in a pack could not be loaded. */
  onError?: (pack: string, message: string) => void

  constructor(private registries: RegistryHub) {}

  setFiles(files: Record<string, string>, assets?: Record<string, string>): void {
    this.files = files
    if (assets) this.assets = assets
  }

  /** Remove everything previously loaded and load all packs again. Returns the pack names. */
  reloadAll(): string[] {
    for (const pack of this.loadedPacks) this.registries.removeOwner(ownerOf(pack))
    this.loadedPacks.clear()

    this.loadFiles(() => true)
    this.loadTextureImages()
    this.loadVoxModels()
    return [...this.loadedPacks]
  }

  /** Load one pack again, leaving the others alone. */
  reloadPack(pack: string): void {
    this.registries.removeOwner(ownerOf(pack))
    this.loadFiles((p) => p === pack)
    this.loadTextureImages(pack)
    this.loadVoxModels(pack)
  }

  private fail(pack: string, path: string, e: unknown): void {
    log.error(`${path}:`, e)
    this.onError?.(pack, `${path}: ${e instanceof Error ? e.message : String(e)}`)
  }

  private loadFiles(wanted: (pack: string) => boolean): void {
    const parsed = Object.entries(this.files)
      .map(([path, raw]) => ({ path, raw, ...parsePath(path) }))
      .filter((f): f is typeof f & { pack: string; registry: string } => !!f.pack && wanted(f.pack))
      // engine registries first, so plugin registries can reference them; stable order otherwise
      .sort((a, b) => Number(a.registry.includes(':')) - Number(b.registry.includes(':')) || a.path.localeCompare(b.path))

    const files = parsed.flatMap((f) => {
      this.loadedPacks.add(f.pack)
      try {
        return [{ ...f, data: this.parse(f.registry, f.raw) }]
      } catch (e) {
        this.fail(f.pack, f.path, e)
        return []
      }
    })
    // Patches go first: plugins that make things out of entries as they appear already see them changed.
    for (const f of files) this.loadPatches(f.pack, f.registry, f.data)
    for (const f of files) {
      try {
        this.loadEntries(f.pack, f.registry, f.data)
      } catch (e) {
        this.fail(f.pack, f.path, e)
      }
    }
  }

  /**
   * `content/<pack>/textures/<name>.png` becomes texture `<pack>:<name>`.
   * If a JSON texture with that id exists, the image replaces its procedural pattern.
   */
  private loadTextureImages(only?: string): void {
    if (!this.registries.has('textures')) return
    const textures = this.registries.get<RegistryEntry & { url?: string }>('textures')
    for (const [path, url] of Object.entries(this.assets)) {
      const m = /content\/([a-z0-9_-]+)\/textures\/([a-z0-9_/-]+)\.png$/.exec(path)
      if (!m) continue
      const [, pack, name] = m
      if (only && pack !== only) continue
      const id = `${pack}:${name}`
      const owner = ownerOf(pack!)
      this.loadedPacks.add(pack!)
      try {
        if (textures.has(id)) textures.modify(id, (t) => ({ ...t, url }), owner)
        else textures.register({ id, url }, owner)
      } catch (e) {
        log.error(`${path}:`, e)
      }
    }
  }

  /** `content/<pack>/models/<name>.vox` becomes model `<pack>:<name>` (unless defined in JSON). */
  private loadVoxModels(only?: string): void {
    if (!this.registries.has('models')) return
    const models = this.registries.get<RegistryEntry & { url?: string }>('models')
    for (const [path, url] of Object.entries(this.assets)) {
      const m = /content\/([a-z0-9_-]+)\/models\/([a-z0-9_/-]+)\.vox$/.exec(path)
      if (!m) continue
      const [, pack, name] = m
      if (only && pack !== only) continue
      const id = `${pack}:${name}`
      this.loadedPacks.add(pack!)
      try {
        if (models.has(id)) models.modify(id, (d) => ({ ...d, url }), ownerOf(pack!))
        else models.register({ id, url }, ownerOf(pack!))
      } catch (e) {
        log.error(`${path}:`, e)
      }
    }
  }

  private parse(registryName: string, raw: string): unknown {
    if (!this.registries.has(registryName)) {
      throw new Error(`нет реестра «${registryName}» (включён ли плагин, который его создаёт?)`)
    }
    return JSON5.parse(raw)
  }

  private loadPatches(pack: string, registryName: string, data: unknown): void {
    const patches = isPlainObject(data) && isPlainObject(data.patch) ? data.patch : {}
    const registry = this.registries.get<RegistryEntry>(registryName)
    for (const [id, change] of Object.entries(patches)) {
      if (isPlainObject(change)) registry.modify(id, (e) => ({ ...deepMerge(e, change), id }), ownerOf(pack))
    }
  }

  private loadEntries(pack: string, registryName: string, data: unknown): void {
    const registry = this.registries.get<RegistryEntry>(registryName)
    const entries = Array.isArray(data) ? data : isPlainObject(data) ? (data.entries ?? []) : []
    const tags = isPlainObject(data) && isPlainObject(data.tags) ? data.tags : {}
    const owner = ownerOf(pack)

    for (const entry of entries as RegistryEntry[]) {
      try {
        registry.register(entry, owner)
      } catch (e) {
        this.fail(pack, `${pack}/${registryName}`, e)
      }
    }
    for (const [tag, ids] of Object.entries(tags)) {
      if (Array.isArray(ids)) registry.tag(tag, ids as string[], owner)
    }
  }
}

const ownerOf = (pack: string) => `content:${pack}`

function parsePath(path: string): { pack?: string; registry?: string } {
  const m = /content\/([a-z0-9_-]+)\/([a-z0-9_.-]+)\.json5$/.exec(path)
  if (!m) return {}
  const [, pack, file] = m
  const dot = file!.indexOf('.')
  const registry = dot < 0 ? file! : `${file!.slice(0, dot)}:${file!.slice(dot + 1)}`
  return { pack, registry }
}
