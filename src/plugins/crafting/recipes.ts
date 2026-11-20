/** Recipe math (pure, tested in tests/crafting.test.ts). */

export interface Ingredient {
  item?: string
  tag?: string
  count: number
}

export type HasTag = (itemId: string, tag: string) => boolean

export function matches(ing: Ingredient, id: string, hasTag: HasTag): boolean {
  return ing.item ? ing.item === id : !!ing.tag && hasTag(id, ing.tag)
}

/** Sum stacks by item id. */
export function tally(slots: ReadonlyArray<{ id: string; count: number } | null>): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of slots) if (s) out.set(s.id, (out.get(s.id) ?? 0) + s.count)
  return out
}

/** How many of an ingredient the pockets hold (before other ingredients take theirs). */
export function have(ing: Ingredient, pocket: ReadonlyMap<string, number>, hasTag: HasTag): number {
  let n = 0
  for (const [id, c] of pocket) if (matches(ing, id, hasTag)) n += c
  return n
}

/**
 * What to take from the pockets for `times` crafts: exact items first, then tags (so a tag doesn't
 * eat the item another ingredient names). Null when something is missing.
 */
export function plan(ings: readonly Ingredient[], pocket: ReadonlyMap<string, number>, hasTag: HasTag, times = 1): Array<[string, number]> | null {
  const left = new Map(pocket)
  const take = new Map<string, number>()
  const ordered = [...ings].sort((a, b) => Number(!a.item) - Number(!b.item))
  for (const ing of ordered) {
    let need = ing.count * times
    for (const [id, c] of left) {
      if (!need) break
      if (!c || !matches(ing, id, hasTag)) continue
      const n = Math.min(c, need)
      left.set(id, c - n)
      take.set(id, (take.get(id) ?? 0) + n)
      need -= n
    }
    if (need > 0) return null
  }
  return [...take]
}
