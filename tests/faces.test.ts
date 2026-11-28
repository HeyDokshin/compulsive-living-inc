import { describe, expect, it } from 'vitest'
import { blinkAmount, moodOfLine, mouthOpen, stepBlink, stripTag, BLINK_SECONDS } from '../src/plugins/faces/mood'

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
    expect(moodOfLine('Мой дом там.')).toBeNull() // not «ой»
    expect(stripTag('Привет. [sad] Пока.')).toBe('Привет. Пока.')
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

  it('blinks and talks without jumps', () => {
    const c = { blinkIn: 0, blinkLeft: 0, talkTime: 0 }
    stepBlink(c, 0.01, () => 0.5, [2, 4])
    let prev = blinkAmount(c)
    for (let i = 0; i < 20; i++) {
      stepBlink(c, 0.01, () => 0.5, [2, 4])
      const now = blinkAmount(c)
      expect(Math.abs(now - prev)).toBeLessThan(0.3)
      prev = now
    }
    let last = mouthOpen(true, 0)
    for (let t = 0.01; t < 3; t += 0.01) {
      const m = mouthOpen(true, t)
      expect(m).toBeGreaterThanOrEqual(0)
      expect(m).toBeLessThanOrEqual(2)
      expect(Math.abs(m - last)).toBeLessThan(0.35)
      last = m
    }
    expect(mouthOpen(false, 1)).toBe(0)
  })
})
