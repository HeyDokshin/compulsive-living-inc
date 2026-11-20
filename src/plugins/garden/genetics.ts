/** Flower color inheritance (pure). */

export interface BreedRule {
  a: string
  b: string
  child: string
  chance: number
}

/** Color of a child of parents `a` × `b`: a matching rule may give a new color, else a parent's color. */
export function breedColor(rules: BreedRule[], a: string, b: string, rand: () => number): string {
  for (const r of rules) {
    const match = (r.a === a && r.b === b) || (r.a === b && r.b === a)
    if (match && rand() < r.chance) return r.child
  }
  return rand() < 0.5 ? a : b
}
