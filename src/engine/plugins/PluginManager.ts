import { createLogger } from '../util/log'

export interface PluginMeta {
  /** Also the namespace for the plugin's ids, config and registries. */
  id: string
  name?: string
  version?: string
  description?: string
  /** Loaded before this plugin; if missing or failed, this plugin is skipped. */
  dependsOn?: string[]
  /** Loaded before this plugin when present. */
  optionalDependsOn?: string[]
  /** Set to false to skip loading without deleting the folder. */
  enabled?: boolean
}

export interface PluginDefinition<Api> extends PluginMeta {
  /** Register content, systems, components, UI. Everything registered through `api` is undone on unload. */
  setup(api: Api): void | Promise<void>
  /** Runs after all plugins are set up and content packs are loaded: spawn entities, read registries. */
  start?(api: Api): void | Promise<void>
}

export interface PluginScope<Api> {
  api: Api
  dispose(): void
}

export type PluginState = 'loaded' | 'failed' | 'skipped'

const log = createLogger('plugins')

/** Dependency-ordered plugin lifecycle with hot reload of a plugin and everything that depends on it. */
export class PluginManager<Api> {
  private defs = new Map<string, PluginDefinition<Api>>()
  private scopes = new Map<string, PluginScope<Api>>()
  private order: string[] = []
  readonly states = new Map<string, { state: PluginState; reason?: string }>()

  constructor(private createScope: (def: PluginDefinition<Api>) => PluginScope<Api>) {}

  register(def: PluginDefinition<Api>): void {
    if (!/^[a-z0-9_]+$/.test(def.id)) throw new Error(`Invalid plugin id "${def.id}" (use a-z, 0-9, _)`)
    this.defs.set(def.id, def)
  }

  get(id: string): PluginDefinition<Api> | undefined {
    return this.defs.get(id)
  }

  all(): PluginDefinition<Api>[] {
    return [...this.defs.values()]
  }

  loadedIds(): string[] {
    return [...this.order]
  }

  isLoaded(id: string): boolean {
    return this.scopes.has(id)
  }

  /** Topological order of all enabled plugins. Plugins with missing deps or cycles are reported and dropped. */
  resolveOrder(): string[] {
    const out: string[] = []
    const visiting = new Set<string>()
    const done = new Set<string>()
    const bad = new Set<string>()

    const visit = (id: string, chain: string[]): boolean => {
      if (done.has(id)) return true
      if (bad.has(id)) return false
      const def = this.defs.get(id)
      if (!def || def.enabled === false) return false
      if (visiting.has(id)) {
        this.skip(id, `dependency cycle: ${[...chain, id].join(' → ')}`)
        bad.add(id)
        return false
      }
      visiting.add(id)
      for (const dep of def.dependsOn ?? []) {
        const depDef = this.defs.get(dep)
        if (!depDef || depDef.enabled === false) {
          this.skip(id, `missing dependency "${dep}"`)
          bad.add(id)
          visiting.delete(id)
          return false
        }
        if (!visit(dep, [...chain, id])) {
          if (!bad.has(id)) this.skip(id, `dependency "${dep}" could not load`)
          bad.add(id)
          visiting.delete(id)
          return false
        }
      }
      for (const dep of def.optionalDependsOn ?? []) if (this.defs.has(dep)) visit(dep, [...chain, id])
      visiting.delete(id)
      done.add(id)
      out.push(id)
      return true
    }

    for (const id of [...this.defs.keys()].sort()) visit(id, [])
    return out
  }

  /** Load every plugin. `afterSetup` runs between setup and start (content packs load there). */
  async loadAll(afterSetup?: () => void | Promise<void>): Promise<void> {
    await this.loadIds(this.resolveOrder(), afterSetup)
  }

  /** Replace definitions (hot reload) and reload them plus all their dependents. */
  async reload(defs: PluginDefinition<Api>[], afterSetup?: () => void | Promise<void>): Promise<string[]> {
    for (const d of defs) this.register(d)
    const changed = new Set(defs.map((d) => d.id))
    const affected = this.withDependents(changed)
    this.unload([...affected])
    const order = this.resolveOrder().filter((id) => affected.has(id))
    await this.loadIds(order, afterSetup)
    return order
  }

  unload(ids: string[]): void {
    const set = new Set(ids)
    for (const id of [...this.order].reverse()) {
      if (!set.has(id)) continue
      this.scopes.get(id)?.dispose()
      this.scopes.delete(id)
      this.states.delete(id)
      log.info(`unloaded ${id}`)
    }
    this.order = this.order.filter((id) => !set.has(id))
  }

  unloadAll(): void {
    this.unload([...this.order])
  }

  /** `ids` + every loaded plugin that (transitively) depends on any of them. */
  withDependents(ids: Set<string>): Set<string> {
    const result = new Set(ids)
    let grew = true
    while (grew) {
      grew = false
      for (const def of this.defs.values()) {
        if (result.has(def.id)) continue
        const deps = [...(def.dependsOn ?? []), ...(def.optionalDependsOn ?? [])]
        if (deps.some((d) => result.has(d))) {
          result.add(def.id)
          grew = true
        }
      }
    }
    return result
  }

  private async loadIds(ids: string[], afterSetup?: () => void | Promise<void>): Promise<void> {
    const started: string[] = []
    for (const id of ids) {
      const def = this.defs.get(id)!
      const failedDep = (def.dependsOn ?? []).find((d) => !this.scopes.has(d))
      if (failedDep) {
        this.skip(id, `dependency "${failedDep}" is not loaded`)
        continue
      }
      const scope = this.createScope(def)
      try {
        await def.setup(scope.api)
        this.scopes.set(id, scope)
        this.order.push(id)
        started.push(id)
      } catch (e) {
        scope.dispose()
        this.states.set(id, { state: 'failed', reason: String(e instanceof Error ? e.message : e) })
        log.error(`setup of "${id}" failed:`, e)
        console.error(e)
      }
    }
    await afterSetup?.()
    for (const id of started) {
      const def = this.defs.get(id)!
      const scope = this.scopes.get(id)
      if (!scope) continue
      try {
        await def.start?.(scope.api)
        this.states.set(id, { state: 'loaded' })
        log.info(`loaded ${id}${def.version ? '@' + def.version : ''}`)
      } catch (e) {
        this.states.set(id, { state: 'failed', reason: String(e instanceof Error ? e.message : e) })
        log.error(`start of "${id}" failed:`, e)
        console.error(e)
      }
    }
  }

  private skip(id: string, reason: string): void {
    if (this.states.get(id)?.state === 'skipped') return
    this.states.set(id, { state: 'skipped', reason })
    log.warn(`skipped "${id}": ${reason}`)
  }
}
