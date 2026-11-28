import JSON5 from 'json5'
import type { GamePlugin } from '../Game'
import { deepMerge, isPlainObject, type PlainObject } from '../util/objects'
import { createLogger } from '../util/log'
import { importMod, shimSource } from './code'
import { IndexedDbModStore, type ModStore } from './ModStore'
import { contentPaths, groupFolders, isAssetFile, isTextFile, orderMods, parseManifest, stripRoot, type ModManifest, type ModPackage } from './package'
import { readZip, writeZip } from './zip'

const log = createLogger('mods')
const ENABLED_KEY = 'cl-mods'
const GUARD_KEY = 'cl-mods-starting'
const SDK_GLOBAL = '__CL_SDK__'

/** A mod as the player sees it. */
export interface ModInfo {
  id: string
  name: string
  version: string
  author: string
  description: string
  /** 'folder' = shipped in mods/, 'installed' = added by the player. */
  source: 'folder' | 'installed'
  /** Runs code (data-only mods can't do anything but add content). */
  hasCode: boolean
  enabled: boolean
  /** Working in the current session. */
  active: boolean
  errors: string[]
}

interface Mod extends ModPackage {
  source: 'folder' | 'installed'
  errors: string[]
  active: boolean
}

export interface ModHost {
  /** Ids that are taken: built-in plugins and content packs. */
  isBuiltIn(id: string): boolean
  sdk: Record<string, unknown>
  /** Bytes a mod may unpack to. */
  maxBytes(): number
}

/**
 * Mods: finding, installing, switching on and off, and turning the enabled ones into content files,
 * configs and plugins. A broken mod never breaks the game — it is skipped and says why.
 */
export class ModManager {
  store: ModStore = new IndexedDbModStore()
  /** Mods are off for this run: the last start with them did not finish. */
  safeMode = false
  private mods = new Map<string, Mod>()
  /** Player's choices; a mod without one follows its manifest. */
  private choices: Record<string, boolean> = {}
  private urls: string[] = []
  private sdkUrl = ''
  private installedBytes = new Map<string, Record<string, Uint8Array>>()

  constructor(private host: ModHost) {}

  /** Read mods of the game folder and installed ones. */
  async init(folderText: Record<string, string>, folderAssets: Record<string, string>): Promise<void> {
    this.choices = readJson(ENABLED_KEY)
    this.setFolder(folderText, folderAssets)
    try {
      for (const stored of await this.store.all()) this.addInstalled(stored.id, stored.files)
    } catch (e) {
      log.error('could not read installed mods:', e)
    }
    this.safeMode = readJson<{ on?: boolean }>(GUARD_KEY).on === true && this.list().some((m) => m.enabled)
  }

  /** Mods of the game folder (again on hot reload). */
  setFolder(text: Record<string, string>, assets: Record<string, string>): void {
    for (const [id, m] of this.mods) if (m.source === 'folder') this.mods.delete(id)
    const assetsOf = groupFolders(assets)
    for (const [folder, files] of groupFolders(text)) {
      try {
        const manifest = parseManifest(files['mod.json5'] ?? '')
        if (manifest.id !== folder) throw new Error(`папка называется ${folder}, а id мода — ${manifest.id}`)
        this.check(manifest)
        if (this.mods.has(manifest.id)) continue // the player's own copy wins
        this.mods.set(manifest.id, { manifest, text: files, assets: assetsOf.get(folder) ?? {}, source: 'folder', errors: [], active: false })
      } catch (e) {
        log.error(`mods/${folder}:`, e)
      }
    }
  }

  list(): ModInfo[] {
    return [...this.mods.values()]
      .map((m) => ({
        id: m.manifest.id,
        name: m.manifest.name,
        version: m.manifest.version,
        author: m.manifest.author,
        description: m.manifest.description,
        source: m.source,
        hasCode: !!m.manifest.main,
        enabled: this.isEnabled(m),
        active: m.active,
        errors: m.errors,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Mods working now — written into saves. */
  active(): Array<{ id: string; name: string; version: string }> {
    return this.list()
      .filter((m) => m.active)
      .map(({ id, name, version }) => ({ id, name, version }))
  }

  setEnabled(id: string, on: boolean): void {
    this.choices[id] = on
    writeJson(ENABLED_KEY, this.choices)
  }

  /** Read a zip without installing it. */
  async open(zip: Uint8Array): Promise<{ manifest: ModManifest; files: Record<string, Uint8Array>; replaces: ModInfo | undefined }> {
    const files = stripRoot(await readZip(zip, this.host.maxBytes()))
    const manifest = parseManifest(new TextDecoder().decode(files['mod.json5']))
    this.check(manifest)
    return { manifest, files, replaces: this.list().find((m) => m.id === manifest.id) }
  }

  async install(manifest: ModManifest, files: Record<string, Uint8Array>): Promise<void> {
    await this.store.put({ id: manifest.id, files })
    this.addInstalled(manifest.id, files)
    this.setEnabled(manifest.id, true)
  }

  async remove(id: string): Promise<void> {
    if (this.mods.get(id)?.source !== 'installed') return
    await this.store.remove(id)
    this.dropAssets(id)
    this.mods.delete(id)
    this.installedBytes.delete(id)
    delete this.choices[id]
    writeJson(ENABLED_KEY, this.choices)
  }

  /** A new empty mod of the player's own, switched on (its content can be edited in the game). */
  async create(m: { id: string; name: string; author?: string; description?: string }): Promise<void> {
    if (this.mods.has(m.id)) throw new Error(`мод «${m.id}» уже есть`)
    const text = JSON5.stringify({ version: '1.0.0', sdk: 1, ...m }, null, 2)
    const manifest = parseManifest(text)
    this.check(manifest)
    await this.install(manifest, { 'mod.json5': new TextEncoder().encode(text) })
    this.mods.get(m.id)!.active = true // nothing in it yet, so it needs no restart
  }

  read(id: string, path: string): string | undefined {
    return this.mods.get(id)?.text[path]
  }

  /** Change one text file of an installed mod (null removes it). */
  async write(id: string, path: string, text: string | null): Promise<void> {
    const mod = this.mods.get(id)
    const bytes = this.installedBytes.get(id)
    if (!mod || !bytes) throw new Error(`мод «${id}» нельзя менять в игре`)
    if (text === null) delete bytes[path]
    else bytes[path] = new TextEncoder().encode(text)
    await this.store.put({ id, files: bytes })
    if (text === null) delete mod.text[path]
    else mod.text[path] = text
  }

  async exportZip(id: string): Promise<Uint8Array> {
    const mod = this.mods.get(id)
    if (!mod) throw new Error(`нет мода «${id}»`)
    const files: Record<string, Uint8Array> = { ...this.installedBytes.get(id) }
    if (mod.source === 'folder') {
      for (const [p, t] of Object.entries(mod.text)) files[p] = new TextEncoder().encode(t)
      for (const [p, url] of Object.entries(mod.assets)) files[p] = new Uint8Array(await (await fetch(url)).arrayBuffer())
    }
    return writeZip(files)
  }

  /** Load the code of every enabled mod. Returns the plugins to register. */
  async activate(): Promise<GamePlugin[]> {
    for (const m of this.mods.values()) {
      m.errors = []
      m.active = false
    }
    for (const url of this.urls.splice(0)) URL.revokeObjectURL(url)
    if (this.safeMode) return []
    const enabled = [...this.mods.values()].filter((m) => this.isEnabled(m)).map((m) => m.manifest)
    const { order, problems } = orderMods(enabled, (id) => this.host.isBuiltIn(id))
    for (const [id, reason] of problems) this.mods.get(id)!.errors.push(reason)
    const plugins: GamePlugin[] = []
    for (const manifest of order) {
      const mod = this.mods.get(manifest.id)!
      try {
        if (manifest.main) plugins.push(...(await this.loadCode(mod)))
        mod.active = true
      } catch (e) {
        mod.errors.push(e instanceof Error ? e.message : String(e))
        log.error(`${manifest.id}:`, e)
      }
    }
    return plugins
  }

  /** Content of the active mods, as the content loader wants it. */
  contentFiles(): Record<string, string> {
    return this.collect((m) => m.text)
  }

  assetFiles(): Record<string, string> {
    return this.collect((m) => m.assets)
  }

  /** `config/<id>.json5` of the active mods laid over the game's own values. */
  mergeConfig(id: string, base: PlainObject): PlainObject {
    let out = base
    for (const m of this.mods.values()) {
      const raw = m.active ? m.text[`config/${id}.json5`] : undefined
      if (raw === undefined) continue
      try {
        const data: unknown = JSON5.parse(raw)
        if (isPlainObject(data)) out = deepMerge(out, data)
      } catch (e) {
        this.report(m.manifest.id, `config/${id}.json5: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    return out
  }

  /** Config ids any mod (active or not) has values for. */
  configIds(): string[] {
    const ids = new Set<string>()
    for (const m of this.mods.values())
      for (const path of Object.keys(m.text)) {
        const id = /^config\/([a-z0-9_-]+)\.json5$/.exec(path)?.[1]
        if (id) ids.add(id)
      }
    return [...ids]
  }

  report(id: string, error: string): void {
    const m = this.mods.get(id)
    if (m && !m.errors.includes(error)) m.errors.push(error)
  }

  reportPlugin(plugin: string, error: string): void {
    for (const m of this.mods.values()) if (plugin === m.manifest.id || plugin.startsWith(m.manifest.id + '_')) this.report(m.manifest.id, `код: ${error}`)
  }

  /** Around a start with mods: if it never finishes (a hang, a crash), the next one goes without them. */
  guard(on: boolean): void {
    if (on) writeJson(GUARD_KEY, { on: true })
    else removeKey(GUARD_KEY)
  }

  private collect(files: (m: Mod) => Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {}
    for (const m of this.mods.values()) if (m.active) Object.assign(out, contentPaths(m.manifest.id, files(m)))
    return out
  }

  private isEnabled(m: Mod): boolean {
    return this.choices[m.manifest.id] ?? m.manifest.enabled
  }

  private check(manifest: ModManifest): void {
    if (this.host.isBuiltIn(manifest.id)) throw new Error(`id «${manifest.id}» занят самой игрой`)
  }

  private addInstalled(id: string, files: Record<string, Uint8Array>): void {
    try {
      const text: Record<string, string> = {}
      const assets: Record<string, string> = {}
      for (const [path, data] of Object.entries(files)) {
        if (isTextFile(path)) text[path] = new TextDecoder().decode(data)
        else if (isAssetFile(path)) assets[path] = URL.createObjectURL(new Blob([data as BlobPart], { type: path.endsWith('.png') ? 'image/png' : '' }))
      }
      const manifest = parseManifest(text['mod.json5'] ?? '')
      this.check(manifest)
      this.dropAssets(id)
      this.mods.set(id, { manifest, text, assets, source: 'installed', errors: [], active: false })
      this.installedBytes.set(id, files)
    } catch (e) {
      log.error(`installed mod ${id}:`, e)
    }
  }

  /** Give back the URLs of an installed mod's images and models. */
  private dropAssets(id: string): void {
    const m = this.mods.get(id)
    if (m?.source === 'installed') for (const url of Object.values(m.assets)) URL.revokeObjectURL(url)
  }

  private async loadCode(mod: Mod): Promise<GamePlugin[]> {
    const { manifest } = mod
    if (!this.sdkUrl) {
      Object.assign(globalThis, { [SDK_GLOBAL]: this.host.sdk })
      this.sdkUrl = URL.createObjectURL(new Blob([shimSource(SDK_GLOBAL, Object.keys(this.host.sdk))], { type: 'text/javascript' }))
    }
    const module = await importMod(mod.text, manifest.main!, this.sdkUrl, this.urls)
    const defs = (Array.isArray(module.default) ? module.default : [module.default]) as Array<GamePlugin | undefined>
    return defs.map((def) => {
      if (!def || typeof def.setup !== 'function') throw new Error(`${manifest.main}: нет export default definePlugin(…)`)
      if (def.id !== manifest.id && !def.id?.startsWith(manifest.id + '_'))
        throw new Error(`id плагина «${def.id}» должен быть «${manifest.id}» или «${manifest.id}_…»`)
      // what the mod needs loads before its code
      return { ...def, version: def.version ?? manifest.version, optionalDependsOn: [...new Set([...(def.optionalDependsOn ?? []), ...manifest.dependsOn])] }
    })
  }
}

function readJson<T extends object = Record<string, boolean>>(key: string): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? '{}') ?? {}) as T
  } catch {
    return {} as T // private mode, blocked storage, tests
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // not persisted
  }
}

function removeKey(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // nothing to remove
  }
}
