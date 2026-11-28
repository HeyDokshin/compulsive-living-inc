/** Quests' pure parts (tested in tests/quests.test.ts): today's tasks, achievement tiers, island rating. */

export interface TaskTemplate {
  id: string
  text: string
  track: string
  params?: Record<string, unknown>
  /** [min, max] of the goal (picked per day). */
  count: [number, number]
  /** Goals are multiples of this (e.g. 500 bells). */
  step?: number
  points: number
  weight: number
}

export interface DailyTask {
  id: string
  goal: number
  progress: number
  done: boolean
}

function rng(seed: number, day: number): () => number {
  let s = (seed ^ Math.imul(day + 1, 0x9e3779b1)) >>> 0
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296
}

/** `n` different tasks for a day (the same all day on the same island), weighted. */
export function pickTasks(templates: readonly TaskTemplate[], n: number, seed: number, day: number): DailyTask[] {
  const rand = rng(seed, day)
  const pool = [...templates].sort((a, b) => (a.id < b.id ? -1 : 1))
  const out: DailyTask[] = []
  // one task per tracker kind at most, so the day has variety
  const used = new Set<string>()
  while (out.length < n && pool.length) {
    const total = pool.reduce((s, t) => s + t.weight, 0)
    let r = rand() * total
    const i = pool.findIndex((t) => (r -= t.weight) < 0)
    const t = pool.splice(i < 0 ? pool.length - 1 : i, 1)[0]!
    if (used.has(t.track + JSON.stringify(t.params ?? {}))) continue
    used.add(t.track + JSON.stringify(t.params ?? {}))
    const [lo, hi] = t.count
    const step = Math.max(1, t.step ?? 1)
    out.push({ id: t.id, goal: lo + Math.floor(rand() * (Math.floor((hi - lo) / step) + 1)) * step, progress: 0, done: false })
  }
  return out
}

/** Add progress; returns true when this made the task complete. */
export function advance(task: DailyTask, by: number): boolean {
  if (task.done || by <= 0) return false
  task.progress = Math.min(task.goal, task.progress + by)
  if (task.progress >= task.goal) task.done = true
  return task.done
}

/** How many tiers of an achievement a stat has reached. */
export function tierOf(value: number, tiers: readonly number[]): number {
  let n = 0
  for (const t of tiers) if (value >= t) n++
  return n
}

export interface RatingInput {
  decor: number
  flowers: number
  trees: number
  paths: number
  villagers: number
  museumShare: number
  houseLevel: number
  projects: number
}

export interface Rating {
  stars: number
  score: number
  /** The weakest parts, as hints. */
  tips: string[]
}

const PARTS: Array<{ key: keyof RatingInput; weight: number; cap: number; tip: string }> = [
  { key: 'decor', weight: 4, cap: 120, tip: 'Поставьте на острове больше поделок: скамейки, фонари, заборы.' },
  { key: 'flowers', weight: 1, cap: 80, tip: 'Посадите цветы — они делают остров наряднее.' },
  { key: 'trees', weight: 1, cap: 60, tip: 'Деревьев могло бы быть больше: посадите саженцы.' },
  { key: 'paths', weight: 0.5, cap: 50, tip: 'Проложите дорожки между домами.' },
  { key: 'villagers', weight: 15, cap: 90, tip: 'Подружитесь с соседями — пусть никто не уезжает.' },
  { key: 'museumShare', weight: 100, cap: 100, tip: 'Пополните музей: пустые витрины ждут.' },
  { key: 'houseLevel', weight: 20, cap: 60, tip: 'Расширьте дом.' },
  { key: 'projects', weight: 40, cap: 80, tip: 'Постройте проекты на доске острова.' },
]
export const STAR_STEPS = [0, 80, 180, 300, 450]

export function rate(input: RatingInput): Rating {
  let score = 0
  const parts = PARTS.map((p) => {
    const v = Math.min(p.cap, input[p.key] * p.weight)
    score += v
    return { tip: p.tip, share: v / p.cap }
  })
  const stars = Math.max(1, STAR_STEPS.filter((s) => score >= s).length)
  const tips = parts
    .sort((a, b) => a.share - b.share)
    .slice(0, 2)
    .filter((p) => p.share < 1)
    .map((p) => p.tip)
  return { stars, score: Math.round(score), tips }
}
