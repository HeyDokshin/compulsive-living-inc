/** Bite timing for fishing (pure, tested in tests/collection.test.ts). */

export interface BiteRules {
  minNibbles: number
  maxNibbles: number
  /** Seconds between nibbles (and before the bite). */
  gapMin: number
  gapMax: number
}

export interface BitePlan {
  /** Seconds (from when the fish reaches the bobber) of each small nibble. */
  nibbles: number[]
  /** Seconds of the real bite. */
  biteAt: number
}

export function planBite(rules: BiteRules, rand: () => number): BitePlan {
  const span = Math.max(0, rules.maxNibbles - rules.minNibbles)
  const n = rules.minNibbles + Math.min(span, Math.floor(rand() * (span + 1)))
  const gap = () => rules.gapMin + rand() * Math.max(0, rules.gapMax - rules.gapMin)
  const nibbles: number[] = []
  let t = gap()
  for (let i = 0; i < n; i++) {
    nibbles.push(t)
    t += gap()
  }
  return { nibbles, biteAt: t }
}

export type ReelResult = 'early' | 'hit' | 'late'

/** Reeling at `t`: before the bite scares the fish, within `window` after it catches it. */
export function judgeReel(t: number, biteAt: number, window: number): ReelResult {
  if (t < biteAt) return 'early'
  return t <= biteAt + window ? 'hit' : 'late'
}
