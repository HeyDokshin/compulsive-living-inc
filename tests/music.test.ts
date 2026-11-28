import { describe, expect, it } from 'vitest'
import { Composer, DAY, NIGHT, midiToHz } from '../src/plugins/ambience/music'

describe('generative music', () => {
  it('plays pads on chord changes, bass on beats 1 and 3, melody inside the scale', () => {
    let seed = 1
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const c = new Composer(rand)
    const notes = Array.from({ length: 64 }, (_, step) => ({ step, n: c.notesAt(step, DAY) }))
    const pads = notes.filter(({ n }) => n.some((x) => x.voice === 'pad')).map(({ step }) => step)
    expect(pads).toEqual([0, 16, 32, 48])
    const bass = notes.filter(({ n }) => n.some((x) => x.voice === 'bass')).map(({ step }) => step % 8)
    expect(new Set(bass)).toEqual(new Set([0, 4]))
    const melody = notes.flatMap(({ n }) => n.filter((x) => x.voice === 'bell').map((x) => x.midi))
    expect(melody.length).toBeGreaterThan(5)
    expect(melody.every((m) => DAY.scale.includes(m))).toBe(true)
  })

  it('rests the melody every fourth phrase; night mood is slower', () => {
    const c = new Composer(() => 0) // always "play"
    const restPhrase = Array.from({ length: 64 }, (_, i) => c.notesAt(192 + i, DAY)).flat()
    expect(restPhrase.some((n) => n.voice === 'bell')).toBe(false)
    expect(NIGHT.bpm).toBeLessThan(DAY.bpm)
    expect(midiToHz(69)).toBe(440)
  })
})
