import { describe, expect, it } from 'vitest'
import { moodOfLine, mouthFrame, stepBlink, stripTag, BLINK_SECONDS } from '../src/plugins/faces/mood'

describe('faces', () => {
  it('reads the mood of a line: tag, words, punctuation', () => {
    expect(moodOfLine('[sad] Всё хорошо!')).toBe('sad')
    expect(stripTag('[sad] Всё хорошо!')).toBe('Всё хорошо!')
    expect(moodOfLine('Ура, ты пришёл!')).toBe('joy')
    expect(moodOfLine('Мне так жаль…')).toBe('sad')
    expect(moodOfLine('Ой! Это мне?!')).toBe('surprised')
    expect(moodOfLine('Хм, дай подумать...')).toBe('thinking')
    expect(moodOfLine('Привет!')).toBe('happy')
    expect(moodOfLine('Хорошая погода.')).toBeNull()
    expect(moodOfLine('[nonsense] Привет.')).toBeNull()
  })

  it('blinks now and then, briefly', () => {
    const c = { blinkIn: 1, blinkLeft: 0, talkTime: 0 }
    let shut = 0
    let blinks = 0
    let was = false
    for (let t = 0; t < 30; t += 0.02) {
      const s = stepBlink(c, 0.02, () => 0.5, [2, 4])
      if (s) shut += 0.02
      if (s && !was) blinks++
      was = s
    }
    expect(blinks).toBeGreaterThanOrEqual(7)
    expect(blinks).toBeLessThanOrEqual(15)
    expect(shut / blinks).toBeCloseTo(BLINK_SECONDS, 1)
  })

  it('moves the mouth only while talking', () => {
    expect(mouthFrame(false, 1.3)).toBe(0)
    const frames = new Set(Array.from({ length: 40 }, (_, i) => mouthFrame(true, i * 0.05)))
    expect(frames).toEqual(new Set([0, 1, 2]))
  })
})
