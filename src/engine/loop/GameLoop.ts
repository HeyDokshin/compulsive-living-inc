import type { TickPhase } from '../types'
import type { Scheduler } from './Scheduler'

export const TICK_PHASES: TickPhase[] = ['input', 'preUpdate', 'update', 'postUpdate']

export interface LoopOptions {
  tickRate: number
  /** Longest real-time gap simulated in one frame (prevents the "spiral of death" after a tab switch). */
  maxFrameTime?: number
  onTickEnd?: () => void
}

/**
 * Fixed-step simulation + variable-rate rendering.
 * `advance(seconds)` is pure (no rAF), which makes the loop testable.
 */
export class GameLoop {
  tick = 0
  time = 0
  paused = false
  timeScale = 1
  private accumulator = 0
  private raf = 0
  private last = 0
  private stepsRequested = 0

  constructor(
    private scheduler: Scheduler,
    public opts: LoopOptions,
  ) {}

  get dt(): number {
    return 1 / this.opts.tickRate
  }

  /** Simulate `seconds` of real time and render once. Returns ticks run. */
  advance(seconds: number): number {
    const max = this.opts.maxFrameTime ?? 0.25
    let ran = 0
    if (!this.paused) this.accumulator += Math.min(seconds, max) * this.timeScale
    while (this.stepsRequested > 0) {
      this.stepsRequested--
      this.step()
      ran++
    }
    while (this.accumulator >= this.dt) {
      this.accumulator -= this.dt
      this.step()
      ran++
    }
    // Frame delta is clamped too: after a long pause (hidden tab) effects and smoothing don't jump.
    this.scheduler.run('render', { dt: Math.min(seconds, max), tick: this.tick, alpha: this.accumulator / this.dt, time: this.time })
    return ran
  }

  /** Run exactly one tick on the next frame, even while paused (debugging). */
  stepOnce(): void {
    this.stepsRequested++
  }

  start(): void {
    this.last = performance.now()
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame)
      const dt = (now - this.last) / 1000
      this.last = now
      this.advance(dt)
    }
    this.raf = requestAnimationFrame(frame)
  }

  stop(): void {
    cancelAnimationFrame(this.raf)
  }

  private step(): void {
    const ctx = { dt: this.dt, tick: this.tick, alpha: 1, time: this.time }
    for (const phase of TICK_PHASES) this.scheduler.run(phase, ctx)
    this.tick++
    this.time += this.dt
    this.opts.onTickEnd?.()
  }
}
