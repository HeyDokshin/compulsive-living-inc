/** Tree life (pure): growth stages by days, fruit regrowth, daily wood limit. */

export interface TreeState {
  kind: string
  /** 0 sapling · 1 young · 2 grown */
  stage: number
  /** Fruit hanging now (0–3). */
  fruit: number
  /** Day when fruit grows back. */
  fruitDay: number
  /** Day of the next growth stage. */
  growDay: number
  /** Wood taken today, and which day that counter belongs to. */
  wood: number
  woodDay: number
}

export interface GrowthRules {
  /** Days per stage (sapling → young → grown). */
  daysPerStage: number
  /** Days for fruit to grow back after shaking. */
  fruitDays: number
  fruitCount: number
  woodPerDay: number
}

export const DEFAULT_RULES: GrowthRules = { daysPerStage: 2, fruitDays: 3, fruitCount: 3, woodPerDay: 3 }

export function newTree(kind: string, today: number, stage: number, bearsFruit: boolean, rules = DEFAULT_RULES): TreeState {
  return {
    kind,
    stage,
    fruit: stage === 2 && bearsFruit ? rules.fruitCount : 0,
    fruitDay: today + rules.fruitDays,
    growDay: today + rules.daysPerStage,
    wood: 0,
    woodDay: today,
  }
}

/** Advance a tree to `day`. Returns true if anything visible changed. */
export function liveDay(t: TreeState, day: number, bearsFruit: boolean, rules = DEFAULT_RULES): boolean {
  let changed = false
  if (t.stage < 2 && day >= t.growDay) {
    t.stage++
    t.growDay = day + rules.daysPerStage
    if (t.stage === 2) t.fruitDay = day + rules.fruitDays
    changed = true
  }
  if (t.stage === 2 && bearsFruit && t.fruit === 0 && day >= t.fruitDay) {
    t.fruit = rules.fruitCount
    changed = true
  }
  if (t.woodDay !== day) {
    t.wood = 0
    t.woodDay = day
  }
  return changed
}

/** Shake: returns how many fruit fall (and schedules regrowth). */
export function shake(t: TreeState, today: number, rules = DEFAULT_RULES): number {
  if (t.stage < 2 || t.fruit === 0) return 0
  const n = t.fruit
  t.fruit = 0
  t.fruitDay = today + rules.fruitDays
  return n
}

/** Chop: true if the tree gives wood now (limited per day). */
export function chop(t: TreeState, today: number, rules = DEFAULT_RULES): boolean {
  if (t.stage < 2) return false
  if (t.woodDay !== today) {
    t.wood = 0
    t.woodDay = today
  }
  if (t.wood >= rules.woodPerDay) return false
  t.wood++
  return true
}
