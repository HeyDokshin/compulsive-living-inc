import JSON5 from 'json5'
import { z } from 'zod'
import { SDK_VERSION } from '../version'

/** `mod.json5` at the root of a mod. */
export const ModManifestSchema = z.looseObject({
  /** Also the namespace of everything the mod adds. */
  id: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/, 'только a-z, 0-9 и _, первая буква — латинская'),
  name: z.string().min(1).max(60),
  version: z.string().default('1.0.0'),
  author: z.string().default(''),
  description: z.string().default(''),
  /** SDK version the mod was made for. */
  sdk: z.number().int().min(1).default(1),
  /** Code entry: an ES module that default-exports `definePlugin(…)`. Leave out for data-only mods. */
  main: z.string().optional(),
  /** Mods and built-in plugins that must be there. */
  dependsOn: z.array(z.string()).default([]),
  /** Mods from the mods/ folder: switched on unless the player decides otherwise. */
  enabled: z.boolean().default(true),
})
export type ModManifest = z.infer<typeof ModManifestSchema>

/** A mod as files: text (manifest, content, code) by path, binary assets as URLs. */
export interface ModPackage {
  manifest: ModManifest
  text: Record<string, string>
  assets: Record<string, string>
}

const TEXT = /\.(json5|json|js|md|txt)$/
const ASSET = /\.(png|vox)$/

export const isTextFile = (path: string): boolean => TEXT.test(path)
export const isAssetFile = (path: string): boolean => ASSET.test(path)

/** Read and check a manifest. Throws a message for the player. */
export function parseManifest(raw: string): ModManifest {
  let data: unknown
  try {
    data = JSON5.parse(raw)
  } catch (e) {
    throw new Error(`mod.json5: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
  }
  const r = ModManifestSchema.safeParse(data)
  if (!r.success) throw new Error(`mod.json5: ${r.error.issues.map((i) => `${i.path.join('.') || 'файл'} — ${i.message}`).join('; ')}`)
  if (r.data.sdk > SDK_VERSION) throw new Error(`мод сделан для SDK ${r.data.sdk}, а в игре SDK ${SDK_VERSION} — обновите игру`)
  return r.data
}

/** Zips often hold one folder with everything inside: find where `mod.json5` is and cut that prefix. */
export function stripRoot<T>(files: Record<string, T>): Record<string, T> {
  const path = Object.keys(files)
    .filter((p) => p === 'mod.json5' || p.endsWith('/mod.json5'))
    .sort((a, b) => a.split('/').length - b.split('/').length)[0]
  if (!path) throw new Error('в моде нет файла mod.json5')
  const root = path.slice(0, -'mod.json5'.length)
  const out: Record<string, T> = {}
  for (const [p, data] of Object.entries(files)) if (p.startsWith(root) && !p.includes('__MACOSX/')) out[p.slice(root.length)] = data
  return out
}

/** `mods/<id>/…` files of the game folder → one file map per mod. */
export function groupFolders<T>(files: Record<string, T>): Map<string, Record<string, T>> {
  const out = new Map<string, Record<string, T>>()
  for (const [path, data] of Object.entries(files)) {
    const m = /mods\/([a-z0-9_]+)\/(.+)$/.exec(path)
    if (!m) continue
    const mod = out.get(m[1]!) ?? {}
    mod[m[2]!] = data
    out.set(m[1]!, mod)
  }
  return out
}

/** A mod's `content/…` files under the path the content loader expects (pack = mod id). */
export function contentPaths<T>(id: string, files: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [path, data] of Object.entries(files)) if (path.startsWith('content/')) out[`/content/${id}/${path.slice('content/'.length)}`] = data
  return out
}

/**
 * Mods in load order: after the mods they depend on. `known` = built-in plugin ids.
 * Those that can't load come back with the reason.
 */
export function orderMods(mods: readonly ModManifest[], known: (id: string) => boolean): { order: ModManifest[]; problems: Map<string, string> } {
  const byId = new Map(mods.map((m) => [m.id, m]))
  const problems = new Map<string, string>()
  const order: ModManifest[] = []
  const state = new Map<string, 'visiting' | 'ok' | 'bad'>()
  const visit = (m: ModManifest): boolean => {
    const s = state.get(m.id)
    if (s) {
      if (s === 'visiting') problems.set(m.id, 'зависимости идут по кругу')
      return s === 'ok'
    }
    state.set(m.id, 'visiting')
    for (const dep of m.dependsOn) {
      const other = byId.get(dep)
      if (other ? !visit(other) : !known(dep)) {
        if (!problems.has(m.id)) problems.set(m.id, other ? `не загружен мод «${other.name}»` : `нужен «${dep}» — его нет или он выключен`)
      }
    }
    const ok = !problems.has(m.id)
    state.set(m.id, ok ? 'ok' : 'bad')
    if (ok) order.push(m)
    return ok
  }
  for (const m of [...mods].sort((a, b) => a.id.localeCompare(b.id))) visit(m)
  return { order, problems }
}
