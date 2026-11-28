import { describe, expect, it } from 'vitest'
import { activityAt, fill, giftTaste, hearts, pickLine, type LineDef } from '../src/plugins/villagers/talk'

const defs: LineDef[] = [
  { id: 'a', topic: 'greet', lines: ['general'] },
  { id: 'b', topic: 'greet', when: { hours: [5, 11] }, lines: ['morning'] },
  { id: 'c', topic: 'greet', when: { weather: 'rain' }, lines: ['rain'] },
  { id: 'd', topic: 'greet', personality: 'p:grumpy', lines: ['grumpy'] },
  { id: 'e', topic: 'greet', when: { minHearts: 3 }, lines: ['friend'] },
]
const s = { personality: 'p:sporty', hour: 15, raining: false, hearts: 0, season: 'autumn' }
const never = () => 0.99 // never takes the "general" branch, picks the last of a pool
const first = () => 0.5

describe('villager lines', () => {
  it('picks the most specific line that fits', () => {
    expect(pickLine(defs, 'greet', s, never)).toBe('general')
    expect(pickLine(defs, 'greet', { ...s, hour: 8 }, never)).toBe('morning')
    expect(pickLine(defs, 'greet', { ...s, raining: true }, never)).toBe('rain')
    expect(pickLine(defs, 'greet', { ...s, personality: 'p:grumpy', hour: 8 }, never)).toBe('grumpy')
    expect(pickLine(defs, 'greet', { ...s, hearts: 4 }, never)).toBe('friend')
    expect(pickLine(defs, 'nothing', s, first)).toBeNull()
  })
  it('fills placeholders', () => {
    expect(fill('Привет, {player}! {phrase}! {x}', { player: 'сосед', phrase: 'ква' })).toBe('Привет, сосед! ква! {x}')
  })
})

describe('friendship and routine', () => {
  it('turns points into hearts', () => {
    expect(hearts(0)).toBe(0)
    expect(hearts(39)).toBe(1)
    expect(hearts(100)).toBe(5)
  })
  it('judges gifts by tags', () => {
    const tags = (t: string[]) => (tag: string) => t.includes(tag)
    expect(giftTaste(tags(['#core:fruits']), ['#core:fruits'], [], 100)).toBe('love')
    expect(giftTaste(tags(['#collection:bugs']), ['#core:fruits'], ['#collection:bugs'], 100)).toBe('dislike')
    expect(giftTaste(tags([]), [], [], 900)).toBe('like')
    expect(giftTaste(tags([]), [], [], 60)).toBe('neutral')
  })
  it('follows the daily schedule, across midnight too', () => {
    const sch: Array<[number, number, string]> = [
      [0, 7, 'sleep'],
      [7, 12, 'garden'],
      [12, 22, 'plaza'],
      [22, 24, 'sleep'],
    ]
    expect(activityAt(sch, 3)).toBe('sleep')
    expect(activityAt(sch, 9.5)).toBe('garden')
    expect(activityAt(sch, 23)).toBe('sleep')
    expect(activityAt([[22, 6, 'sleep']], 2)).toBe('sleep')
    expect(activityAt([], 10)).toBe('wander')
  })
})
