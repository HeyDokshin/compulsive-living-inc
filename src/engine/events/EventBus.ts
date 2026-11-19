import type { Dispose } from '../util/disposables'

type Handler<P> = (payload: P) => void

/** Typed fire-and-forget events: "something happened". A failing handler never breaks the others. */
export class EventBus<M extends object> {
  private handlers = new Map<keyof M, Set<Handler<never>>>()

  on<K extends keyof M>(name: K, fn: Handler<M[K]>): Dispose {
    let set = this.handlers.get(name)
    if (!set) this.handlers.set(name, (set = new Set()))
    set.add(fn as Handler<never>)
    return () => set!.delete(fn as Handler<never>)
  }

  once<K extends keyof M>(name: K, fn: Handler<M[K]>): Dispose {
    const off = this.on(name, (p) => {
      off()
      fn(p)
    })
    return off
  }

  emit<K extends keyof M>(name: K, payload: M[K]): void {
    const set = this.handlers.get(name)
    if (!set) return
    for (const fn of [...set]) {
      try {
        ;(fn as Handler<M[K]>)(payload)
      } catch (e) {
        console.error(`[events] handler for "${String(name)}" failed`, e)
      }
    }
  }

  listenerCount(name: keyof M): number {
    return this.handlers.get(name)?.size ?? 0
  }
}
