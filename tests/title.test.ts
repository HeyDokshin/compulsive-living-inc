import { describe, expect, it } from 'vitest'
import { MAX_NAME, cleanName, parseSeed } from '../src/engine/session/names'
import { finishedBy, lessonFor } from '../src/plugins/tutorial/days'

describe('names and seeds', () => {
  it('cleans names', () => {
    expect(cleanName('  Тихая   бухта ')).toBe('Тихая бухта')
    expect(cleanName('я'.repeat(50))).toHaveLength(MAX_NAME)
    expect(cleanName('   ')).toBe('')
  })
  it('keeps numeric seeds, hashes words, leaves empty to chance', () => {
    expect(parseSeed(' 12345 ')).toBe(12345)
    expect(parseSeed('')).toBeUndefined()
    const a = parseSeed('клубника')
    expect(a).toBe(parseSeed('клубника'))
    expect(a).not.toBe(parseSeed('черника'))
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(2 ** 31)
    expect(parseSeed('99999999999')).toBeLessThan(2 ** 31)
  })
})

describe('tutorial days', () => {
  const steps = [
    { id: 'b', order: 2 },
    { id: 'a', order: 1 },
    { id: 'c', order: 1, day: 2 },
    { id: 'd', order: 1, day: 3 },
  ]
  it('shows the day that has come, earlier days first', () => {
    expect(lessonFor(steps, [], 1)).toMatchObject({ day: 1, current: { id: 'a' } })
    expect(lessonFor(steps, ['a'], 3)).toMatchObject({ day: 1, current: { id: 'b' } })
    expect(lessonFor(steps, ['a', 'b'], 1)).toBeNull()
    expect(lessonFor(steps, ['a', 'b'], 2)).toMatchObject({ day: 2, current: { id: 'c' } })
    expect(lessonFor(steps, ['a', 'b', 'c', 'd'], 9)).toBeNull()
  })
  it('knows when a day or everything is finished', () => {
    expect(finishedBy(steps, ['a'], 'a')).toBeNull()
    expect(finishedBy(steps, ['a', 'b'], 'b')).toBe('day')
    expect(finishedBy(steps, ['a', 'b', 'c', 'd'], 'c')).toBe('all')
    expect(finishedBy(steps, ['x'], 'x')).toBeNull()
  })
})
