/** What the content editor does with data — no UI, no game. */
export type Obj = Record<string, unknown>

export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** The smallest patch that turns `base` into `edited` (objects merge, the rest is replaced). */
export function diff(base: Obj, edited: Obj): Obj {
  const out: Obj = {}
  for (const [k, v] of Object.entries(edited)) {
    const old = base[k]
    if (same(old, v)) continue
    if (isObj(old) && isObj(v)) {
      const d = diff(old, v)
      if (Object.keys(d).length) out[k] = d
    } else out[k] = v
  }
  return out
}

/** Keys of `base` that `edited` lost — a patch can't take keys away. */
export function removedKeys(base: Obj, edited: Obj, path = ''): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue
    if (edited[k] === undefined) out.push(path + k)
    else if (isObj(v) && isObj(edited[k])) out.push(...removedKeys(v, edited[k], `${path}${k}.`))
  }
  return out
}

// ---------- pack files ----------

export interface PackFile {
  entries: Array<Obj & { id: string }>
  patch: Record<string, Obj>
  tags: Record<string, string[]>
}

/** `content/<registry>.json5` of a mod: `villagers:lines` → `content/villagers.lines.json5`. */
export const packPath = (registry: string): string => `content/${registry.replace(':', '.')}.json5`

export function readPack(data: unknown): PackFile {
  if (Array.isArray(data)) return { entries: data as PackFile['entries'], patch: {}, tags: {} }
  const o = isObj(data) ? data : {}
  return {
    entries: (Array.isArray(o.entries) ? o.entries : []) as PackFile['entries'],
    patch: (isObj(o.patch) ? o.patch : {}) as PackFile['patch'],
    tags: (isObj(o.tags) ? o.tags : {}) as PackFile['tags'],
  }
}

/** Text of a pack file, or null when nothing is left in it. */
export function writePack(p: PackFile): string | null {
  const out: Obj = {}
  if (p.entries.length) out.entries = p.entries
  if (Object.keys(p.patch).length) out.patch = p.patch
  if (Object.keys(p.tags).length) out.tags = p.tags
  return Object.keys(out).length ? JSON.stringify(out, null, 2) + '\n' : null
}

/** Put an edited entry into a pack: the mod's own entries whole, others as a patch (nothing changed → no patch). */
export function putEntry(p: PackFile, entry: Obj & { id: string }, base: Obj | null): PackFile {
  if (!base) {
    const at = p.entries.findIndex((e) => e.id === entry.id)
    return { ...p, entries: at < 0 ? [...p.entries, entry] : p.entries.map((e, i) => (i === at ? entry : e)) }
  }
  const patch = { ...p.patch }
  const change = diff(base, entry)
  if (Object.keys(change).length) patch[entry.id] = change
  else delete patch[entry.id]
  return { ...p, patch }
}

/** Forget what a pack says about an entry. */
export function dropEntry(p: PackFile, id: string): PackFile {
  const patch = { ...p.patch }
  delete patch[id]
  return { ...p, entries: p.entries.filter((e) => e.id !== id), patch }
}

// ---------- form fields ----------

export type FieldKind = 'text' | 'long' | 'number' | 'bool' | 'choice' | 'color' | 'lines' | 'json'

export interface Field {
  key: string
  kind: FieldKind
  options?: string[]
  required: boolean
}

interface JsonSchema {
  type?: string | string[]
  enum?: unknown[]
  items?: JsonSchema
  properties?: Record<string, JsonSchema>
  required?: string[]
}

const COLOR = /^#[0-9a-f]{6}$/i

/** Fields of an entry: what its schema knows plus whatever else it holds. `id` is not a field. */
export function fieldsOf(schema: unknown, entry: Obj): Field[] {
  const s = (isObj(schema) ? schema : {}) as JsonSchema
  const props = s.properties ?? {}
  const keys = [...new Set([...Object.keys(props), ...Object.keys(entry)])].filter((k) => k !== 'id')
  return keys.map((key) => {
    const p = props[key] ?? {}
    const required = s.required?.includes(key) ?? false
    const options = p.enum?.filter((x): x is string => typeof x === 'string')
    if (options?.length) return { key, kind: 'choice', options, required }
    return { key, kind: kindOf(p, entry[key]), required }
  })
}

function kindOf(p: JsonSchema, value: unknown): FieldKind {
  const type = typeof p.type === 'string' ? p.type : undefined
  if (type === 'boolean' || typeof value === 'boolean') return 'bool'
  if (type === 'number' || type === 'integer' || typeof value === 'number') return 'number'
  if (type === 'string' || typeof value === 'string') {
    if (typeof value === 'string' && COLOR.test(value)) return 'color'
    return typeof value === 'string' && value.length > 60 ? 'long' : 'text'
  }
  if (Array.isArray(value) ? value.length > 0 && value.every((x) => typeof x === 'string') : p.items?.type === 'string') return 'lines'
  return 'json'
}

/** `entry` with one field set; `undefined` takes the field away. */
export function setField(entry: Obj, key: string, value: unknown): Obj {
  const out = { ...entry }
  if (value === undefined) delete out[key]
  else out[key] = value
  return out
}

/** A free id in the mod's namespace: `my_mod:apple`, `my_mod:apple_2`… */
export function freeId(modId: string, from: string, taken: (id: string) => boolean): string {
  const name = from.split(':')[1]?.replace(/_\d+$/, '') || 'new'
  let id = `${modId}:${name}`
  for (let n = 2; taken(id); n++) id = `${modId}:${name}_${n}`
  return id
}

/** Does an entry match what was typed in the search box? */
export function matches(entry: Obj, query: string): boolean {
  const q = query.trim().toLowerCase()
  return !q || String(entry.id).includes(q) || (typeof entry.name === 'string' && entry.name.toLowerCase().includes(q))
}

/** A mod id made of a name: «Мой сад!» → `moi_sad`. */
export function slug(name: string): string {
  const latin: Record<string, string> = Object.fromEntries(
    'а:a б:b в:v г:g д:d е:e ё:e ж:zh з:z и:i й:i к:k л:l м:m н:n о:o п:p р:r с:s т:t у:u ф:f х:h ц:ts ч:ch ш:sh щ:sch ъ: ы:y ь: э:e ю:yu я:ya'
      .split(' ')
      .map((p) => p.split(':') as [string, string]),
  )
  const out = [...name.toLowerCase()]
    .map((c) => latin[c] ?? c)
    .join('')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[_0-9]+|_+$/g, '')
    .slice(0, 32)
  return out.length >= 2 ? out : 'my_mod'
}
