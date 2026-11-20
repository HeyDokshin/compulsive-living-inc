import { describe, expect, it } from 'vitest'
import { seasonOf, toGameDate, localDayIndex } from '../src/engine/time/calendar'
import { TimeService } from '../src/engine/time/TimeService'
import { EventBus } from '../src/engine/events/EventBus'
import { EngineConfigSchema } from '../src/engine/engineConfig'
import type { GameEvents } from '../src/engine/types'

describe('calendar', () => {
  it('maps months to seasons for both hemispheres', () => {
    expect(seasonOf(10, 'north')).toBe('autumn')
    expect(seasonOf(10, 'south')).toBe('spring')
    expect(seasonOf(0, 'north')).toBe('winter')
    expect(seasonOf(6, 'south')).toBe('winter')
  })

  it('local day index changes at local midnight', () => {
    const a = new Date(2026, 10, 20, 23, 59)
    const b = new Date(2026, 10, 21, 0, 1)
    expect(localDayIndex(b) - localDayIndex(a)).toBe(1)
    const g = toGameDate(new Date(2026, 10, 20, 14, 30).getTime())
    expect(g.hour).toBeCloseTo(14.5)
    expect(g.season).toBe('autumn')
  })
})

function clock(mode: 'real' | 'scaled' | 'frozen', maxCatchUpDays = 30) {
  const cfg = EngineConfigSchema.parse({ time: { mode, scale: 3600, maxCatchUpDays } }).time
  const events = new EventBus<GameEvents>()
  const days: Array<{ dayIndex: number; catchUp: boolean }> = []
  const hours: number[] = []
  events.on('time:day', (d) => days.push({ dayIndex: d.dayIndex, catchUp: d.catchUp }))
  events.on('time:hour', (h) => hours.push(h.hour))
  return { t: new TimeService(cfg, events), days, hours, cfg }
}

describe('TimeService', () => {
  it('scaled clock advances while playing and fires hour/day events', () => {
    const { t, days, hours } = clock('scaled')
    t.reset()
    const start = t.now()
    for (let i = 0; i < 30; i++) t.tick(1, false) // 30 real s × 3600 = 30 game hours
    expect(t.now().ms - start.ms).toBeCloseTo(30 * 3_600_000, -3)
    expect(days.length).toBeGreaterThanOrEqual(1)
    expect(hours.length).toBeGreaterThanOrEqual(29)
    const before = t.now().ms
    t.tick(10, true) // paused: no time passes
    expect(t.now().ms).toBe(before)
  })

  it('replays days missed while away (capped) after loading', () => {
    const { t, days } = clock('real', 5)
    t.reset()
    const saved = t.save()
    saved.lastDayIndex -= 9 // pretend the save is 9 days old
    t.load(saved)
    expect(days).toHaveLength(0) // nothing until the session has started
    t.flushCatchUp()
    expect(days).toHaveLength(5) // capped
    expect(days.slice(0, 4).every((d) => d.catchUp)).toBe(true)
    expect(days[4]!.catchUp).toBe(false)
    expect(days[4]!.dayIndex).toBe(t.now().dayIndex)
  })

  it('time travel forward lives through the days; going back does not', () => {
    const { t, days } = clock('real')
    t.reset()
    t.shift(3 * 86_400_000)
    expect(days.map((d) => d.dayIndex)).toEqual([1, 2, 3].map((n) => t.now().dayIndex - 3 + n))
    t.shift(-2 * 86_400_000)
    t.tick(0.016, false)
    expect(days).toHaveLength(3)
    t.setHour(18.5)
    expect(t.now().hour).toBeCloseTo(18.5, 1)
  })
})
