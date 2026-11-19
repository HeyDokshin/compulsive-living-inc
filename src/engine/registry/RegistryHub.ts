import type { ZodType } from 'zod'
import { Registry, assertId, type RegistryEntry } from './Registry'

/** Owns every registry. Engine registries use plain names (`blocks`); plugin ones are namespaced (`fishing:baits`). */
export class RegistryHub {
  private registries = new Map<string, Registry<RegistryEntry>>()

  create<T extends RegistryEntry>(name: string, schema: ZodType<T> | undefined, owner: string): Registry<T> {
    if (owner !== 'engine') assertId(name, 'registry name')
    if (this.registries.has(name)) throw new Error(`Registry "${name}" already exists`)
    const r = new Registry<T>(name, schema, owner)
    this.registries.set(name, r as unknown as Registry<RegistryEntry>)
    return r
  }

  get<T extends RegistryEntry = RegistryEntry>(name: string): Registry<T> {
    const r = this.registries.get(name)
    if (!r) throw new Error(`Unknown registry "${name}". Known: ${this.names().join(', ')}`)
    return r as unknown as Registry<T>
  }

  has(name: string): boolean {
    return this.registries.has(name)
  }

  names(): string[] {
    return [...this.registries.keys()]
  }

  /** Undo everything an owner contributed, and drop registries it created. */
  removeOwner(owner: string): void {
    for (const [name, r] of this.registries) {
      if (r.owner === owner) this.registries.delete(name)
      else r.removeOwner(owner)
    }
  }
}
