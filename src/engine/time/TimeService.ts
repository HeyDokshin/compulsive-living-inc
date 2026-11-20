import type { EventBus } from '../events/EventBus'
import type { EngineConfig } from '../engineConfig'
import type { GameEvents } from '../types'
import { toGameDate, type GameDate } from './calendar'

/** What a save remembers about time. */
export interface SavedTime {
  /** real mode: offset added to the device clock (time travel); scaled mode: the game clock itself. */
  offsetMs: number
  scaledMs: number
  /** Last game day the island has lived through (for catching up days that passed while away). */
  lastDayIndex: number
}

/**
 * The game clock. Modes:
 * - real: the device clock (+ offset) — days pass while you are away, like cozy island games
 * - scaled: a fast clock that only runs while playing (`time.scale` game seconds per real second)
 * - frozen: stands still at `time.frozenHour`
 * Emits `time:hour` and `time:day` (also for days missed while away, capped), `time:season`.
 */
export class TimeService {
  private offsetMs = 0
  private scaledMs = Date.now()
  private lastHour = -1
  private lastDay = -1
  private lastSeason = ''
  private pendingCatchUp = 0
  private cached?: GameDate
  private cachedAt = -1

  constructor(
    private cfg: EngineConfig['time'],
    private events: EventBus<GameEvents>,
  ) {}

  nowMs(): number {
    switch (this.cfg.mode) {
      case 'real':
        return Date.now() + this.offsetMs
      case 'scaled':
        return this.scaledMs
      case 'frozen': {
        const d = new Date(Date.now() + this.offsetMs)
        d.setHours(0, 0, 0, 0)
        return d.getTime() + this.cfg.frozenHour * 3_600_000
      }
    }
  }

  /** Current date, cached per millisecond tick of the clock. */
  now(): GameDate {
    const ms = this.nowMs()
    if (this.cachedAt !== ms || !this.cached) {
      this.cached = toGameDate(ms, this.cfg.hemisphere)
      this.cachedAt = ms
    }
    return this.cached
  }

  /** Per frame: advance the scaled clock and fire hour/day/season events. */
  tick(realDt: number, paused: boolean): void {
    if (this.cfg.mode === 'scaled' && !paused) this.scaledMs += realDt * 1000 * this.cfg.scale
    this.checkBoundaries()
  }

  /** New island: today is day one, nothing to catch up. */
  reset(): void {
    this.offsetMs = 0
    this.scaledMs = Date.now()
    this.lastDay = this.now().dayIndex
    this.lastHour = Math.floor(this.now().hour)
    this.lastSeason = this.now().season
    this.pendingCatchUp = 0
  }

  save(): SavedTime {
    return { offsetMs: this.offsetMs, scaledMs: this.scaledMs, lastDayIndex: this.lastDay }
  }

  /** Restore a save; days that passed since then are replayed once the session has started. */
  load(s: SavedTime): void {
    this.offsetMs = s.offsetMs
    this.scaledMs = s.scaledMs
    const today = this.now().dayIndex
    this.pendingCatchUp = Math.max(0, Math.min(this.cfg.maxCatchUpDays, today - s.lastDayIndex))
    this.lastDay = today - this.pendingCatchUp
    this.lastHour = Math.floor(this.now().hour)
    this.lastSeason = this.now().season
  }

  /** Fire the catch-up days (call after plugins started). */
  flushCatchUp(): void {
    const n = this.pendingCatchUp
    this.pendingCatchUp = 0
    for (let i = 0; i < n; i++) {
      this.lastDay++
      this.events.emit('time:day', { dayIndex: this.lastDay, date: this.now(), catchUp: i < n - 1 })
    }
  }

  /** Jump to a time of day today (debug / time travel). */
  setHour(hour: number): void {
    const now = this.now()
    const delta = (hour - now.hour) * 3_600_000
    this.shift(delta)
  }

  /** Move the clock by `ms` (positive = forward). Days passed are lived through. */
  shift(ms: number): void {
    if (this.cfg.mode === 'scaled') this.scaledMs += ms
    else this.offsetMs += ms
    this.checkBoundaries()
  }

  private checkBoundaries(): void {
    const now = this.now()
    if (this.lastDay < 0) this.reset()
    // whole days (maybe several after a jump)
    let guard = 0
    while (now.dayIndex > this.lastDay && guard++ < this.cfg.maxCatchUpDays) {
      this.lastDay++
      this.events.emit('time:day', { dayIndex: this.lastDay, date: now, catchUp: this.lastDay < now.dayIndex })
    }
    if (now.dayIndex < this.lastDay) this.lastDay = now.dayIndex // went back in time: no events
    const h = Math.floor(now.hour)
    if (h !== this.lastHour) {
      this.lastHour = h
      this.events.emit('time:hour', { hour: h, dayIndex: now.dayIndex })
    }
    if (now.season !== this.lastSeason) {
      const had = this.lastSeason
      this.lastSeason = now.season
      if (had) this.events.emit('time:season', { season: now.season })
    }
  }
}
