import type { Dispose } from '../util/disposables'

/** APIs plugins offer each other (`api.services`). One provider per name; removed with its plugin. */
export class ServiceRegistry {
  private services = new Map<string, { impl: unknown; owner: string }>()

  provide(name: string, impl: unknown, owner: string): Dispose {
    const existing = this.services.get(name)
    if (existing && existing.owner !== owner) throw new Error(`Service "${name}" is already provided by "${existing.owner}"`)
    this.services.set(name, { impl, owner })
    return () => {
      if (this.services.get(name)?.owner === owner) this.services.delete(name)
    }
  }

  get<T>(name: string): T {
    const s = this.services.get(name)
    if (!s) throw new Error(`Service "${name}" is not available (is its plugin loaded and in dependsOn?)`)
    return s.impl as T
  }

  has(name: string): boolean {
    return this.services.has(name)
  }
}
