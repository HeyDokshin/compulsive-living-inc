/** Villagers' minds, the pure parts (tested in tests/villagers.test.ts): lines, friendship, routine. */

export interface LineDef {
  id: string
  topic: string
  personality?: string
  when?: { hours?: [number, number]; weather?: 'rain' | 'dry'; minHearts?: number; maxHearts?: number; seasons?: string[] }
  lines: string[]
}

export interface Situation {
  personality: string
  hour: number
  raining: boolean
  hearts: number
  season: string
}

const inHours = (h: [number, number], hour: number) => (h[0] <= h[1] ? hour >= h[0] && hour < h[1] : hour >= h[0] || hour < h[1])

export function matches(def: LineDef, s: Situation): boolean {
  if (def.personality && def.personality !== s.personality) return false
  const w = def.when
  if (!w) return true
  if (w.hours && !inHours(w.hours, s.hour)) return false
  if (w.weather === 'rain' && !s.raining) return false
  if (w.weather === 'dry' && s.raining) return false
  if (w.minHearts !== undefined && s.hearts < w.minHearts) return false
  if (w.maxHearts !== undefined && s.hearts > w.maxHearts) return false
  if (w.seasons && !w.seasons.includes(s.season)) return false
  return true
}

/** How specific an entry is: own personality first, then the number of conditions. */
function specificity(def: LineDef): number {
  return (def.personality ? 10 : 0) + Object.keys(def.when ?? {}).length
}

/**
 * A line for a topic. Among the entries that fit, the most specific ones win most of the time, but
 * general ones still come up (`generalShare`), so a villager doesn't repeat the same thing forever.
 */
export function pickLine(defs: readonly LineDef[], topic: string, s: Situation, rand: () => number, generalShare = 0.3): string | null {
  const fit = defs.filter((d) => d.topic === topic && matches(d, s))
  if (!fit.length) return null
  const best = Math.max(...fit.map(specificity))
  const top = fit.filter((d) => specificity(d) === best)
  const pool = rand() < generalShare ? fit : top
  const def = pool[Math.floor(rand() * pool.length)]!
  return def.lines[Math.floor(rand() * def.lines.length)] ?? null
}

/** Fill {placeholders}; unknown ones stay as they are. */
export function fill(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

// --- friendship ---------------------------------------------------------------------------------

export const MAX_POINTS = 100
export const hearts = (points: number) => Math.max(0, Math.min(5, Math.floor(points / 20)))

export type GiftTaste = 'favourite' | 'love' | 'like' | 'neutral' | 'dislike' | 'hated'

/** A thing someone feels strongly about: an item id or a `#tag`. */
export const isOf = (of: string, id: string, hasTag: (tag: string) => boolean) => (of.startsWith('#') ? hasTag(of) : of === id)

/**
 * How a villager takes a gift: their own favourite and the thing they can't stand first, then what
 * their character loves or doesn't care for, and decor and other priced things are nice.
 */
export function giftTaste(
  id: string,
  hasTag: (tag: string) => boolean,
  taste: { likes: readonly string[]; dislikes: readonly string[]; favourite?: string; hated?: string },
  price: number,
): GiftTaste {
  if (taste.favourite && isOf(taste.favourite, id, hasTag)) return 'favourite'
  if (taste.hated && isOf(taste.hated, id, hasTag)) return 'hated'
  if (taste.likes.some(hasTag)) return 'love'
  if (taste.dislikes.some(hasTag)) return 'dislike'
  return price >= 500 ? 'like' : 'neutral'
}

/**
 * Letters a villager writes in the morning (who to, and about what), from yesterday: thanks for a
 * gift they loved or for help, news of a friendship grown, or now and then just a chat.
 */
export type LetterTopic = 'letter_thanks' | 'letter_help' | 'letter_level' | 'letter_chat'
export function lettersDue(r: { points: number; level?: number; thanks?: string; helped?: string; met: boolean }, chat: boolean): LetterTopic[] {
  if (!r.met) return []
  const out: LetterTopic[] = []
  if (r.thanks) out.push('letter_thanks')
  if (r.helped) out.push('letter_help')
  if (hearts(r.points) > (r.level ?? 0)) out.push('letter_level')
  if (!out.length && chat && hearts(r.points) >= 2) out.push('letter_chat')
  return out
}

// --- routine ------------------------------------------------------------------------------------

/** What a schedule says to do at an hour ([from, to) entries; the last match wins; default wander). */
export function activityAt(schedule: ReadonlyArray<readonly [number, number, string]>, hour: number): string {
  let act = 'wander'
  for (const [from, to, a] of schedule) if (inHours([from, to], hour)) act = a
  return act
}
