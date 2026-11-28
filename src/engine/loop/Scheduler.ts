import type { Phase, TickContext } from '../types'
import type { Dispose } from '../util/disposables'
import { createLogger } from '../util/log'

export interface SystemDef {
  id: string
  phase: Phase
  /** Lower runs first. Engine systems use ±1000. */
  priority?: number
  /** Only while the island is being played: paused while the player is in a room (villagers walking,
   * bugs, fish, growing things — the island waits, as it is, until you come back). */
  outdoors?: boolean
  run(ctx: TickContext): void
}

interface SystemEntry extends SystemDef {
  owner: string
  enabled: boolean
  order: number
}

const log = createLogger('systems')

/** Ordered systems per phase. A system that throws is disabled (and reported) instead of breaking the loop. */
export class Scheduler {
  private systems: SystemEntry[] = []
  private counter = 0
  /** Is the player in a room? (outdoor systems wait) */
  indoors: () => boolean = () => false

  add(def: SystemDef, owner: string): Dispose {
    if (this.systems.some((s) => s.id === def.id)) throw new Error(`System "${def.id}" already exists`)
    const entry: SystemEntry = { ...def, owner, enabled: true, order: this.counter++ }
    this.systems.push(entry)
    this.systems.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.order - b.order)
    return () => {
      const i = this.systems.indexOf(entry)
      if (i >= 0) this.systems.splice(i, 1)
    }
  }

  run(phase: Phase, ctx: TickContext): void {
    const indoors = this.indoors()
    for (const s of this.systems) {
      if (s.phase !== phase || !s.enabled || (indoors && s.outdoors)) continue
      try {
        s.run(ctx)
      } catch (e) {
        s.enabled = false
        log.error(`System "${s.id}" (${s.owner}) threw and was disabled:`, e)
        console.error(e)
      }
    }
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const s = this.systems.find((x) => x.id === id)
    if (s) s.enabled = enabled
    return !!s
  }

  list(): ReadonlyArray<Readonly<SystemEntry>> {
    return this.systems
  }
}
