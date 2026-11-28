/** The mailbox, the pure part (tested in tests/mail.test.ts): letters in, old ones out. */

export interface Letter {
  /** Unique in this box (grows). */
  id: number
  /** Who wrote it (shown as the signature). */
  from: string
  /** Who that is (a villager id…), for the sender's own picture or colors. */
  fromId?: string
  text: string
  /** Something tucked into the envelope: an item and how many. */
  gift?: { item: string; count: number }
  /** Game day it arrived. */
  day: number
  read: boolean
  /** The gift was taken out. */
  taken: boolean
}

/** Still wants the player's attention: unread, or with something left in the envelope. */
export const pending = (l: Letter) => !l.read || (!!l.gift && !l.taken)

/**
 * The box with a new letter in, newest first. When it holds more than `keep`, the oldest letters that
 * are done with (read, nothing left inside) go; letters still pending stay, up to twice `keep`.
 */
export function withLetter(letters: readonly Letter[], letter: Letter, keep: number): Letter[] {
  const out = [letter, ...letters]
  for (let i = out.length - 1; i >= 0 && out.length > keep; i--) if (!pending(out[i]!)) out.splice(i, 1)
  // a box nobody empties: the oldest go anyway
  if (out.length > keep * 2) out.length = keep * 2
  return out
}
