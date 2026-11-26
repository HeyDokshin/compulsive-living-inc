/** Face states and timing for drawn faces — pure, testable. */

export const EXPRESSIONS = ['neutral', 'happy', 'joy', 'sad', 'worried', 'angry', 'surprised', 'sleepy', 'love', 'shy', 'thinking', 'wink'] as const
export type Expression = (typeof EXPRESSIONS)[number]

/** `[joy] Hello!` → joy (the tag is for the face, not to be shown). Lines put together keep theirs. */
const TAG = /\[([a-z]+)\]\s*/
const TAGS = /\[[a-z]+\]\s*/g

/** A line without its face tags. */
export function stripTag(text: string): string {
  return text.replace(TAGS, '').trim()
}

const WORDS: Array<[Expression, RegExp]> = [
  ['love', /❤|♥|💕|обожаю|люблю|прелесть|чудо как/i],
  ['sad', /жаль|грустн|скуча|увы|эх[,.!…\s]|печал|плак|одиноко|прощай/i],
  // whole words: \b knows only Latin letters ("мой" must not read as "ой")
  ['angry', /(?<!\p{L})фу(?!\p{L})|хмф|грр|не люблю|сердит|злит|безобраз|ну уж нет/iu],
  ['sleepy', /зев|сонн|спать|спим|хр-р|ночи|устал/i],
  ['surprised', /\?!|!\?|(?<!\p{L})(ой|ого)(?!\p{L})|неужели|правда\?|вот это да|ух ты/iu],
  ['shy', /смущ|стесн|краснею|неловко/i],
  ['thinking', /(?<!\p{L})хм+|интересно\.\.\.|интересно…|дума(ю|ет)|может быть|наверное/iu],
  ['joy', /ура|здорово|отлично|чудесн|прекрасн|замечательн|потрясающ|класс/i],
]

/**
 * The expression a line suggests: its first `[tag]` wins, then telling words, then punctuation
 * ("!" — happy, "…" — thinking). Null when nothing stands out (the face keeps its mood).
 */
export function moodOfLine(text: string): Expression | null {
  const tag = TAG.exec(text)?.[1]
  if (tag && (EXPRESSIONS as readonly string[]).includes(tag)) return tag as Expression
  for (const [expr, re] of WORDS) if (re.test(text)) return expr
  if (/!/.test(text)) return 'happy'
  if (/…|\.\.\./.test(text)) return 'thinking'
  return null
}

export interface FaceClock {
  /** Seconds until the next blink. */
  blinkIn: number
  /** Seconds left of the current blink (eyes shut). */
  blinkLeft: number
  /** Talking: time spent, for the mouth. */
  talkTime: number
}

export const BLINK_SECONDS = 0.13

/** Advance blinking; `rand` in [0, 1). Returns true while the eyes are shut. */
export function stepBlink(c: FaceClock, dt: number, rand: () => number, every: [number, number]): boolean {
  if (c.blinkLeft > 0) {
    c.blinkLeft = Math.max(0, c.blinkLeft - dt)
    return c.blinkLeft > 0
  }
  c.blinkIn -= dt
  if (c.blinkIn <= 0) {
    c.blinkLeft = BLINK_SECONDS
    // now and then a double blink
    c.blinkIn = rand() < 0.15 ? BLINK_SECONDS * 2.5 : every[0] + rand() * (every[1] - every[0])
    return true
  }
  return false
}

/** How shut the eyes are during a blink (0 open … 1 shut), easing down and back up. */
export function blinkAmount(c: FaceClock): number {
  if (c.blinkLeft <= 0) return 0
  return Math.sin(Math.PI * (1 - c.blinkLeft / BLINK_SECONDS))
}

/** Mouth openness while talking, continuous 0…2: an uneven, lively rhythm with no jumps. */
export function mouthOpen(talking: boolean, t: number): number {
  if (!talking) return 0
  const syllable = 0.5 - 0.5 * Math.cos(t * 13 + Math.sin(t * 3.1) * 2.2)
  const loud = 0.65 + 0.35 * Math.sin(t * 2.3 + 1)
  return 2 * syllable * loud
}
