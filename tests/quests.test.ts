import { describe, expect, it } from 'vitest'
import { advance, pickTasks, rate, tierOf, type TaskTemplate } from '../src/plugins/quests/logic'

const t = (id: string, track: string, params?: Record<string, unknown>): TaskTemplate => ({ id, text: id, track, params, count: [2, 4], points: 50, weight: 1 })
const templates = [
  t('a', 'catch', { kind: 'fish' }),
  t('b', 'catch', { kind: 'bug' }),
  t('c', 'talk'),
  t('d', 'craft'),
  t('e', 'sell'),
  t('f', 'catch', { kind: 'fish' }),
]

describe('daily tasks', () => {
  it('are the same all day and change from day to day', () => {
    const today = pickTasks(templates, 4, 9, 100)
    expect(pickTasks(templates, 4, 9, 100)).toEqual(today)
    const days = new Set(
      Array.from({ length: 8 }, (_, d) =>
        pickTasks(templates, 4, 9, 100 + d)
          .map((x) => x.id)
          .join(),
      ),
    )
    expect(days.size).toBeGreaterThan(2)
  })
  it('never repeats the same kind of task in a day, and goals are in range', () => {
    for (let d = 0; d < 30; d++) {
      const day = pickTasks(templates, 5, 1, d)
      expect(day.filter((x) => x.id === 'a' || x.id === 'f').length).toBeLessThanOrEqual(1)
      for (const x of day) {
        expect(x.goal).toBeGreaterThanOrEqual(2)
        expect(x.goal).toBeLessThanOrEqual(4)
      }
    }
  })
  it('advance completes once', () => {
    const task = { id: 'a', goal: 3, progress: 0, done: false }
    expect(advance(task, 2)).toBe(false)
    expect(advance(task, 5)).toBe(true)
    expect(task.progress).toBe(3)
    expect(advance(task, 1)).toBe(false)
  })
})

describe('achievements and rating', () => {
  it('counts tiers', () => {
    expect(tierOf(0, [1, 10, 50])).toBe(0)
    expect(tierOf(12, [1, 10, 50])).toBe(2)
    expect(tierOf(99, [1, 10, 50])).toBe(3)
  })
  it('rates the island and gives hints for its weakest parts', () => {
    const empty = rate({ decor: 0, flowers: 0, trees: 0, paths: 0, villagers: 0, museumShare: 0, houseLevel: 1, projects: 0 })
    expect(empty.stars).toBe(1)
    expect(empty.tips.length).toBe(2)
    const lovely = rate({ decor: 40, flowers: 100, trees: 70, paths: 120, villagers: 6, museumShare: 1, houseLevel: 3, projects: 2 })
    expect(lovely.stars).toBe(5)
    expect(lovely.tips).toEqual([])
  })
})

describe('calendar events', async () => {
  const { isOn } = await import('../src/plugins/events/calendar')
  it('checks date ranges, also over the new year, and weekdays', () => {
    expect(isOn({ from: [11, 15], to: [11, 30] }, { month: 11, day: 20, weekday: 5 })).toBe(true)
    expect(isOn({ from: [11, 15], to: [11, 30] }, { month: 12, day: 1, weekday: 2 })).toBe(false)
    expect(isOn({ from: [12, 15], to: [1, 7] }, { month: 1, day: 3, weekday: 1 })).toBe(true)
    expect(isOn({ from: [12, 15], to: [1, 7] }, { month: 1, day: 8, weekday: 2 })).toBe(false)
    expect(isOn({ weekdays: [6] }, { month: 3, day: 7, weekday: 6 })).toBe(true)
    expect(isOn({ weekdays: [6] }, { month: 3, day: 8, weekday: 0 })).toBe(false)
    expect(isOn({}, { month: 3, day: 8, weekday: 0 })).toBe(false)
  })
})
