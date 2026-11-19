import type { ZodType } from 'zod'
import type { Dispose } from '../util/disposables'

export interface RegistryEntry {
  id: string
  tags?: string[]
}

export type RegistryChange = { registry: string; id: string; kind: 'register' | 'unregister' | 'modify' | 'tag' }

/** `namespace:path` — lowercase letters, digits, `_`, `/`, `.`, `-` in the path. */
export const ID_PATTERN = /^[a-z0-9_]+:[a-z0-9_./-]+$/

export function assertId(id: string, what = 'id'): void {
  if (!ID_PATTERN.test(id)) throw new Error(`Invalid ${what} "${id}": expected "namespace:name"`)
}

interface Patch<T> {
  owner: string
  priority: number
  fn: (entry: T) => T
}

/** What a plugin sees: every write is attributed to that plugin so it can be undone on unload. */
export interface RegistryView<T extends RegistryEntry> {
  readonly name: string
  register(entry: T): T
  modify(id: string, fn: (entry: T) => T, opts?: { priority?: number }): void
  tag(tag: string, ids: string[]): void
  get(id: string): T | undefined
  require(id: string): T
  has(id: string): boolean
  all(): T[]
  ids(): string[]
  tagged(tag: string): T[]
  isTagged(id: string, tag: string): boolean
  resolve(ref: string): T[]
  onChange(fn: (change: RegistryChange) => void): Dispose
}

/**
 * A named collection of content definitions with namespaced ids.
 * - `register` adds a base entry (validated by the schema, if any)
 * - `modify` layers patches over an entry (also for entries registered later), removable per owner
 * - tags group ids (`#core:fruits`) so mechanics never hardcode concrete ids
 */
export class Registry<T extends RegistryEntry> {
  private base = new Map<string, { entry: T; owner: string }>()
  private patches = new Map<string, Patch<T>[]>()
  private tags = new Map<string, Map<string, string>>() // tag -> (id -> owner)
  private cache = new Map<string, T>()
  private listeners = new Set<(c: RegistryChange) => void>()

  constructor(
    readonly name: string,
    private schema?: ZodType<T>,
    readonly owner = 'engine',
  ) {}

  register(entry: T, owner: string): T {
    assertId(entry.id)
    const existing = this.base.get(entry.id)
    if (existing) {
      throw new Error(`[${this.name}] "${entry.id}" is already registered by "${existing.owner}"`)
    }
    const parsed = this.schema ? this.validate(entry) : entry
    this.base.set(parsed.id, { entry: parsed, owner })
    for (const t of parsed.tags ?? []) this.addTag(t, parsed.id, owner)
    this.invalidate(parsed.id, 'register')
    return parsed
  }

  modify(id: string, fn: (entry: T) => T, owner: string, priority = 0): void {
    const list = this.patches.get(id) ?? []
    list.push({ owner, fn, priority })
    list.sort((a, b) => a.priority - b.priority)
    this.patches.set(id, list)
    this.invalidate(id, 'modify')
  }

  tag(tag: string, ids: string[], owner: string): void {
    for (const id of ids) this.addTag(tag, id, owner)
    this.emit({ registry: this.name, id: tag, kind: 'tag' })
  }

  get(id: string): T | undefined {
    const cached = this.cache.get(id)
    if (cached) return cached
    const b = this.base.get(id)
    if (!b) return undefined
    let entry = b.entry
    for (const p of this.patches.get(id) ?? []) {
      try {
        entry = p.fn({ ...entry })
      } catch (e) {
        console.error(`[${this.name}] patch by "${p.owner}" on "${id}" failed`, e)
      }
    }
    if (this.patches.has(id) && this.schema) entry = this.validate(entry)
    this.cache.set(id, entry)
    return entry
  }

  require(id: string): T {
    const e = this.get(id)
    if (!e) throw new Error(`[${this.name}] unknown id "${id}"`)
    return e
  }

  has(id: string): boolean {
    return this.base.has(id)
  }

  ids(): string[] {
    return [...this.base.keys()]
  }

  all(): T[] {
    return this.ids().map((id) => this.get(id)!)
  }

  get size(): number {
    return this.base.size
  }

  isTagged(id: string, tag: string): boolean {
    return this.tags.get(stripHash(tag))?.has(id) ?? false
  }

  tagged(tag: string): T[] {
    const ids = this.tags.get(stripHash(tag))
    return ids ? [...ids.keys()].map((id) => this.get(id)).filter((e): e is T => !!e) : []
  }

  /** `#ns:tag` → all tagged entries; `ns:id` → that entry (or nothing). */
  resolve(ref: string): T[] {
    if (ref.startsWith('#')) return this.tagged(ref)
    const e = this.get(ref)
    return e ? [e] : []
  }

  unregister(id: string): void {
    if (!this.base.delete(id)) return
    for (const ids of this.tags.values()) ids.delete(id)
    this.invalidate(id, 'unregister')
  }

  /** Removes everything a given owner contributed: entries, patches and tag memberships. */
  removeOwner(owner: string): void {
    for (const [id, b] of [...this.base]) if (b.owner === owner) this.unregister(id)
    for (const [id, list] of this.patches) {
      const kept = list.filter((p) => p.owner !== owner)
      if (kept.length !== list.length) {
        this.patches.set(id, kept)
        this.invalidate(id, 'modify')
      }
    }
    for (const [tag, ids] of this.tags) {
      for (const [id, o] of [...ids]) if (o === owner) ids.delete(id)
      if (ids.size === 0) this.tags.delete(tag)
    }
  }

  onChange(fn: (c: RegistryChange) => void): Dispose {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  view(owner: string, track: (d: Dispose) => void): RegistryView<T> {
    return {
      name: this.name,
      register: (e) => this.register(e, owner),
      modify: (id, fn, opts) => this.modify(id, fn, owner, opts?.priority),
      tag: (tag, ids) => this.tag(tag, ids, owner),
      get: (id) => this.get(id),
      require: (id) => this.require(id),
      has: (id) => this.has(id),
      all: () => this.all(),
      ids: () => this.ids(),
      tagged: (t) => this.tagged(t),
      isTagged: (id, t) => this.isTagged(id, t),
      resolve: (r) => this.resolve(r),
      onChange: (fn) => {
        const off = this.onChange(fn)
        track(off)
        return off
      },
    }
  }

  private validate(entry: T): T {
    const r = this.schema!.safeParse(entry)
    if (!r.success) {
      const issues = r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
      throw new Error(`[${this.name}] invalid entry "${entry.id}": ${issues}`)
    }
    return r.data
  }

  private addTag(tag: string, id: string, owner: string): void {
    const t = stripHash(tag)
    assertId(t, 'tag')
    let ids = this.tags.get(t)
    if (!ids) this.tags.set(t, (ids = new Map()))
    ids.set(id, owner)
  }

  private invalidate(id: string, kind: RegistryChange['kind']): void {
    this.cache.delete(id)
    this.emit({ registry: this.name, id, kind })
  }

  private emit(c: RegistryChange): void {
    for (const fn of [...this.listeners]) {
      try {
        fn(c)
      } catch (e) {
        console.error(`[${this.name}] change listener failed`, e)
      }
    }
  }
}

const stripHash = (t: string) => (t.startsWith('#') ? t.slice(1) : t)
