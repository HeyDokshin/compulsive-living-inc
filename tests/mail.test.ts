import { describe, expect, it } from 'vitest'
import { pending, withLetter, type Letter } from '../src/plugins/mail/box'

const letter = (id: number, over: Partial<Letter> = {}): Letter => ({ id, from: 'Кто-то', text: '…', day: id, read: false, taken: false, ...over })

describe('mailbox', () => {
  it('puts the newest letter on top', () => {
    const box = withLetter([letter(1)], letter(2), 10)
    expect(box.map((l) => l.id)).toEqual([2, 1])
  })

  it('lets the oldest finished letters go when full, never the pending ones', () => {
    const old = [letter(3, { read: true }), letter(2), letter(1, { read: true, gift: { item: 'core:apple', count: 1 } })]
    // 1 still has its gift inside, 2 is unread: only 3 may go
    const box = withLetter(old, letter(4), 3)
    expect(box.map((l) => l.id)).toEqual([4, 2, 1])
    expect(pending(box[2]!)).toBe(true)
  })

  it('keeps at most twice as many letters when nothing is ever read', () => {
    let box: Letter[] = []
    for (let i = 0; i < 30; i++) box = withLetter(box, letter(i), 5)
    expect(box).toHaveLength(10)
    expect(box[0]!.id).toBe(29)
  })
})
