/** Generative cozy music: pure note choice (no audio here), so it can be tested and tuned. */

export interface Mood {
  bpm: number
  /** Chords as MIDI note triads, two bars each. */
  chords: number[][]
  /** Melody scale (MIDI). */
  scale: number[]
  /** Chance a melody note plays on an eighth. */
  density: number
}

export const DAY: Mood = {
  bpm: 76,
  chords: [
    [60, 64, 67], // C
    [57, 60, 64], // Am
    [53, 57, 60], // F
    [55, 59, 62], // G
  ],
  scale: [72, 74, 76, 79, 81, 84], // C major pentatonic
  density: 0.42,
}

export const NIGHT: Mood = {
  bpm: 62,
  chords: [
    [57, 60, 64], // Am
    [53, 57, 60], // F
    [60, 64, 67], // C
    [52, 55, 59], // Em
  ],
  scale: [69, 72, 74, 76, 79], // A minor pentatonic
  density: 0.3,
}

/** At home: slow and warm, F major, few notes. */
export const HOME: Mood = {
  bpm: 66,
  chords: [
    [53, 57, 60], // F
    [57, 60, 64], // Am
    [50, 53, 57], // Dm
    [55, 58, 62], // Gm
  ],
  scale: [65, 67, 69, 72, 74, 77], // F major pentatonic
  density: 0.3,
}

/** In the museum: hushed and spacious, long chords and a sparse melody. */
export const MUSEUM: Mood = {
  bpm: 54,
  chords: [
    [50, 53, 57], // Dm
    [55, 59, 62], // G
    [52, 55, 59], // Em
    [57, 60, 64], // Am
  ],
  scale: [62, 64, 65, 69, 71, 74], // D dorian, no leading tones
  density: 0.2,
}

/** In the shop: bright and bouncy. */
export const SHOP: Mood = {
  bpm: 96,
  chords: [
    [55, 59, 62], // G
    [52, 55, 59], // Em
    [48, 52, 55], // C
    [50, 54, 57], // D
  ],
  scale: [67, 69, 71, 74, 76, 79], // G major pentatonic
  density: 0.5,
}

export const MOODS = { home: HOME, museum: MUSEUM, shop: SHOP } as const
export type RoomMood = keyof typeof MOODS

export interface MusicNote {
  midi: number
  /** Beats. */
  length: number
  voice: 'pad' | 'bass' | 'bell'
}

/** Step = one eighth note. Returns the notes that start on it. */
export class Composer {
  private melodyIndex = 2
  constructor(private rand: () => number = Math.random) {}

  notesAt(step: number, mood: Mood): MusicNote[] {
    const out: MusicNote[] = []
    const chordIndex = Math.floor(step / 16) % mood.chords.length
    const chord = mood.chords[chordIndex]!
    const phrase = Math.floor(step / 64)
    const inBar = step % 8
    if (step % 16 === 0) for (const n of chord) out.push({ midi: n, length: 8, voice: 'pad' })
    if (inBar === 0 || inBar === 4) out.push({ midi: chord[0]! - 12, length: 1.5, voice: 'bass' })
    // Every fourth phrase rests the melody: breathing room.
    if (phrase % 4 !== 3) {
      const onBeat = inBar % 2 === 0
      if (this.rand() < mood.density * (onBeat ? 1.3 : 0.6)) {
        const move = Math.floor(this.rand() * 5) - 2 // -2..2 steps
        this.melodyIndex = Math.max(0, Math.min(mood.scale.length - 1, this.melodyIndex + move))
        out.push({ midi: mood.scale[this.melodyIndex]!, length: onBeat ? 1 : 0.5, voice: 'bell' })
      }
    }
    return out
  }
}

export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)
