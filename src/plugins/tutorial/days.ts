/** Which tutorial step to show: steps are grouped by island day, earlier days come first. */
export interface DayStep {
  id: string
  order: number
  /** Island day the step belongs to (1 = the first). */
  day?: number
}

export const dayOf = (s: DayStep): number => s.day ?? 1

export interface Lesson<T extends DayStep> {
  day: number
  /** All steps of that day, in order. */
  steps: T[]
  current: T
}

/** The first unfinished day that has come, or null when there is nothing to do (today). */
export function lessonFor<T extends DayStep>(steps: readonly T[], done: readonly string[], today: number): Lesson<T> | null {
  let day = Infinity
  for (const s of steps) if (dayOf(s) <= today && dayOf(s) < day && !done.includes(s.id)) day = dayOf(s)
  if (day === Infinity) return null
  const list = steps.filter((s) => dayOf(s) === day).sort((a, b) => a.order - b.order)
  return { day, steps: list, current: list.find((s) => !done.includes(s.id))! }
}

/** After finishing `id`: did that complete its day, or the whole tutorial? */
export function finishedBy<T extends DayStep>(steps: readonly T[], done: readonly string[], id: string): 'day' | 'all' | null {
  const step = steps.find((s) => s.id === id)
  if (!step) return null
  if (steps.every((s) => done.includes(s.id))) return 'all'
  return steps.every((s) => dayOf(s) !== dayOf(step) || done.includes(s.id)) ? 'day' : null
}
