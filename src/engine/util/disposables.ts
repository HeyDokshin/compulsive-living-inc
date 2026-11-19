export type Dispose = () => void

/** Collects cleanup callbacks and runs them in reverse order. */
export class DisposableStack {
  private items: Dispose[] = []

  add(fn: Dispose): Dispose {
    this.items.push(fn)
    return fn
  }

  dispose(): void {
    const items = this.items.reverse()
    this.items = []
    for (const fn of items) {
      try {
        fn()
      } catch (e) {
        console.error('[dispose]', e)
      }
    }
  }
}
