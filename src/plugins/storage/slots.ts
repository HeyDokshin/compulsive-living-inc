/** Slot math for chests (pure, tested in tests/crafting.test.ts). */

export type Slot = { id: string; count: number } | null

/** Put `count` of an item into slots: top up stacks of it first, then empty slots. Returns what didn't fit. */
export function putInto(slots: Slot[], id: string, count: number, maxStack: number): number {
  let left = count
  for (const s of slots) {
    if (!left) break
    if (s && s.id === id && s.count < maxStack) {
      const n = Math.min(maxStack - s.count, left)
      s.count += n
      left -= n
    }
  }
  for (let i = 0; i < slots.length && left; i++) {
    if (slots[i]) continue
    const n = Math.min(maxStack, left)
    slots[i] = { id, count: n }
    left -= n
  }
  return left
}

/** Take up to `count` from one slot; returns how many were taken. */
export function takeFrom(slots: Slot[], index: number, count: number): number {
  const s = slots[index]
  if (!s) return 0
  const n = Math.min(s.count, count)
  s.count -= n
  if (!s.count) slots[index] = null
  return n
}

export const isEmpty = (slots: readonly Slot[]) => slots.every((s) => !s)
