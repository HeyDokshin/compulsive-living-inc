import type { ZodType } from 'zod'
import { assignDeep, isPlainObject, setPath, type PlainObject } from '../util/objects'
import type { Dispose } from '../util/disposables'
import { createLogger } from '../util/log'

interface ConfigEntry {
  id: string
  owner: string
  schema: ZodType
  /** Live values. The object identity never changes — mutate in place. */
  values: PlainObject
  listeners: Set<() => void>
}

const log = createLogger('config')

/**
 * Typed, live-tunable configuration.
 * Value priority: schema defaults < config/<id>.json5 < live edits (debug panel / console).
 */
export class ConfigService {
  private entries = new Map<string, ConfigEntry>()
  private files = new Map<string, PlainObject>()
  private globalListeners = new Set<(id: string) => void>()

  define<T extends PlainObject>(id: string, schema: ZodType<T>, owner: string): T {
    const existing = this.entries.get(id)
    if (existing && existing.owner !== owner) throw new Error(`Config "${id}" already defined by "${existing.owner}"`)
    const values = existing?.values ?? {}
    const entry: ConfigEntry = { id, owner, schema, values, listeners: existing?.listeners ?? new Set() }
    this.entries.set(id, entry)
    // Re-defining (hot reload) keeps live tweaks; the new schema still strips/validates them.
    this.reparse(entry, existing ? structuredClone(existing.values) : (this.files.get(id) ?? {}))
    return values as T
  }

  undefine(id: string): void {
    this.entries.delete(id)
  }

  get<T extends PlainObject = PlainObject>(id: string): T | undefined {
    return this.entries.get(id)?.values as T | undefined
  }

  schema(id: string): ZodType | undefined {
    return this.entries.get(id)?.schema
  }

  ids(): string[] {
    return [...this.entries.keys()]
  }

  /** Data coming from config/<id>.json5 (on startup and on hot reload). */
  setFileData(id: string, data: PlainObject): void {
    this.files.set(id, data)
    const entry = this.entries.get(id)
    if (entry) this.reparse(entry, data)
  }

  /** Set one value by dotted path, validating the whole config. */
  set(id: string, path: string, value: unknown): void {
    const entry = this.require(id)
    const next = structuredClone(entry.values)
    setPath(next, path, value)
    const r = entry.schema.safeParse(next)
    if (!r.success) throw new Error(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    assignDeep(entry.values, r.data as PlainObject)
    this.notify(id)
  }

  resetToDefaults(id: string): void {
    this.reparse(this.require(id), {})
  }

  resetToFile(id: string): void {
    this.reparse(this.require(id), this.files.get(id) ?? {})
  }

  /** Call after mutating values directly (e.g. a debug panel binding). */
  notify(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    for (const fn of [...entry.listeners]) fn()
    for (const fn of [...this.globalListeners]) fn(id)
  }

  onChange(id: string, fn: () => void): Dispose {
    const entry = this.require(id)
    entry.listeners.add(fn)
    return () => entry.listeners.delete(fn)
  }

  onAnyChange(fn: (id: string) => void): Dispose {
    this.globalListeners.add(fn)
    return () => this.globalListeners.delete(fn)
  }

  /** Dev only: persist current values to config/<id>.json5 through the Vite dev server. */
  async saveToFile(id: string): Promise<void> {
    const entry = this.require(id)
    const res = await fetch(`/__dev/config/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify(entry.values),
    })
    if (!res.ok) throw new Error(`Saving config "${id}" failed: ${await res.text()}`)
    this.files.set(id, structuredClone(entry.values))
  }

  private reparse(entry: ConfigEntry, data: PlainObject): void {
    const r = entry.schema.safeParse(data)
    let parsed: unknown
    if (r.success) parsed = r.data
    else {
      log.error(`config/${entry.id}.json5 is invalid, using defaults:`, r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
      parsed = entry.schema.parse({})
    }
    if (!isPlainObject(parsed)) throw new Error(`Config "${entry.id}" schema must describe an object`)
    assignDeep(entry.values, parsed)
    this.notify(entry.id)
  }

  private require(id: string): ConfigEntry {
    const e = this.entries.get(id)
    if (!e) throw new Error(`Unknown config "${id}"`)
    return e
  }
}
