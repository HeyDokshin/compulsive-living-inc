/**
 * The island market: how much the sell box pays for a kind of goods today. Each category drifts on
 * its own weekly wave (phase from the island seed) with a little daily noise, so prices are the
 * same for everyone on the island that day and worth watching over the week. Pure, tested.
 */

export interface MarketCategory {
  id: string
  /** How far the price swings from 1 (0.3 → 0.7…1.3). */
  amplitude: number
}

/** Integer hash → [0, 1). */
export function hash01(...n: number[]): number {
  let h = 2166136261 >>> 0
  for (const v of n) {
    h ^= Math.floor(v) >>> 0
    h = Math.imul(h, 16777619) >>> 0
    h ^= h >>> 13
    h = Math.imul(h, 0x5bd1e995) >>> 0
  }
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

/** Stable small number from a string (category ids). */
export function strHash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return h >>> 0
}

/** Price multiplier for a category on a day (rounded to 5%). */
export function demand(seed: number, day: number, cat: MarketCategory, period = 7): number {
  const k = strHash(cat.id)
  const phase = hash01(seed, k)
  const wave = Math.sin(2 * Math.PI * (day / period + phase))
  const noise = hash01(seed, k, day) * 2 - 1
  const m = 1 + cat.amplitude * (0.7 * wave + 0.3 * noise)
  return Math.round(Math.max(0.1, m) * 20) / 20
}

/** The category an item belongs to: the first whose tag it carries. */
export function categoryOf<T extends { id: string }>(cats: readonly T[], hasTag: (cat: T) => boolean): T | undefined {
  return cats.find(hasTag)
}

/** "+30%" / "−15%" / "±0%". */
export function formatDemand(m: number): string {
  const p = Math.round((m - 1) * 100)
  return p > 0 ? `+${p}%` : p < 0 ? `−${-p}%` : '±0%'
}
