import JSON5 from 'json5'
import type { RegistryHub } from '../registry/RegistryHub'
import type { RegistryEntry } from '../registry/Registry'
import { isPlainObject } from '../util/objects'
import { createLogger } from '../util/log'

const log = createLogger('content')

/**
 * Data packs: `content/<pack>/<registry>.json5`.
 * The file name picks the registry: `blocks.json5` → `blocks`, `fishing.baits.json5` → `fishing:baits`.
 *
 * File format — either an array of entries, or:
 *   { entries: [...], tags: { 'core:ground': ['core:grass', ...] } }
 */
export class ContentLoader {
  private files: Record<string, string> = {}
  private assets: Record<string, string> = {}
  private loadedPacks = new Set<string>()

  constructor(private registries: RegistryHub) {}

  setFiles(files: Record<string, string>, assets?: Record<string, string>): void {
    this.files = files
    if (assets) this.assets = assets
  }

  /** Remove everything previously loaded and load all packs again. Returns the pack names. */
  reloadAll(): string[] {
    for (const pack of this.loadedPacks) this.registries.removeOwner(ownerOf(pack))
    this.loadedPacks.clear()

    const parsed = Object.entries(this.files)
      .map(([path, raw]) => ({ path, raw, ...parsePath(path) }))
      .filter((f): f is typeof f & { pack: string; registry: string } => !!f.pack)
      // engine registries first, so plugin registries can reference them; stable order otherwise
      .sort((a, b) => Number(a.registry.includes(':')) - Number(b.registry.includes(':')) || a.path.localeCompare(b.path))

    for (const f of parsed) {
      this.loadedPacks.add(f.pack)
      try {
        this.loadFile(f.pack, f.registry, f.raw)
      } catch (e) {
        log.error(`${f.path}:`, e)
      }
    }
    this.loadTextureImages()
    this.loadVoxModels()
    return [...this.loadedPacks]
  }

  /**
   * `content/<pack>/textures/<name>.png` becomes texture `<pack>:<name>`.
   * If a JSON texture with that id exists, the image replaces its procedural pattern.
   */
  private loadTextureImages(): void {
    if (!this.registries.has('textures')) return
    const textures = this.registries.get<RegistryEntry & { url?: string }>('textures')
    for (const [path, url] of Object.entries(this.assets)) {
      const m = /content\/([a-z0-9_-]+)\/textures\/([a-z0-9_/-]+)\.png$/.exec(path)
      if (!m) continue
      const [, pack, name] = m
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
  private loadVoxModels(): void {
    if (!this.registries.has('models')) return
    const models = this.registries.get<RegistryEntry & { url?: string }>('models')
    for (const [path, url] of Object.entries(this.assets)) {
      const m = /content\/([a-z0-9_-]+)\/models\/([a-z0-9_/-]+)\.vox$/.exec(path)
      if (!m) continue
      const [, pack, name] = m
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

  private loadFile(pack: string, registryName: string, raw: string): void {
    if (!this.registries.has(registryName)) {
      throw new Error(`no registry "${registryName}" (is the plugin that creates it enabled?)`)
    }
    const registry = this.registries.get<RegistryEntry>(registryName)
    const data: unknown = JSON5.parse(raw)
    const entries = Array.isArray(data) ? data : isPlainObject(data) ? (data.entries ?? []) : []
    const tags = isPlainObject(data) && isPlainObject(data.tags) ? data.tags : {}
    const owner = ownerOf(pack)

    for (const entry of entries as RegistryEntry[]) {
      try {
        registry.register(entry, owner)
      } catch (e) {
        log.error(`${pack}/${registryName}:`, e)
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
