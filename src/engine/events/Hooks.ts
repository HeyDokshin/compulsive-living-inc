import type { Dispose } from '../util/disposables'

/** Each hook maps to `{ value, ctx }`: taps receive the value and return a (possibly changed) value. */
export type HookSpec = { value: unknown; ctx: unknown }
type Tap<S extends HookSpec> = (value: S['value'], ctx: S['ctx']) => S['value']
interface TapEntry { fn: Tap<HookSpec>; priority: number; order: number }

/**
 * Interceptable hooks: "something is about to happen".
 * Taps run from lowest to highest priority, each transforming the value (waterfall).
 * Convention for cancellable actions: the value carries `cancelled: boolean`.
 */
export class Hooks<M extends { [K in keyof M]: HookSpec }> {
  private taps = new Map<keyof M, TapEntry[]>()
  private counter = 0

  tap<K extends keyof M>(name: K, fn: Tap<M[K]>, opts: { priority?: number } = {}): Dispose {
    const list = this.taps.get(name) ?? []
    const entry: TapEntry = { fn: fn as unknown as Tap<HookSpec>, priority: opts.priority ?? 0, order: this.counter++ }
    list.push(entry)
    list.sort((a, b) => a.priority - b.priority || a.order - b.order)
    this.taps.set(name, list)
    return () => {
      const i = list.indexOf(entry)
      if (i >= 0) list.splice(i, 1)
    }
  }

  run<K extends keyof M>(name: K, value: M[K]['value'], ctx: M[K]['ctx']): M[K]['value'] {
    const list = this.taps.get(name)
    if (!list) return value
    let v = value
    for (const t of [...list]) {
      try {
        v = t.fn(v, ctx) as M[K]['value']
      } catch (e) {
        console.error(`[hooks] tap for "${String(name)}" failed`, e)
      }
    }
    return v
  }
}
