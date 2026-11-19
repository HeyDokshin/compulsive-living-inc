/** Pocket logic (pure): stacks, adding, removing, swapping. */

export interface Stack {
  id: string
  count: number
}

export interface Inventory {
  slots: Array<Stack | null>
  /** Slot whose item is in the hands (null = empty hands). */
  equipped: number | null
}

export function createInventory(size: number): Inventory {
  return { slots: Array.from({ length: size }, () => null), equipped: null }
}

/** Add items, filling existing stacks first. Returns how many did NOT fit. */
export function addItems(inv: Inventory, id: string, count: number, maxStack: number): number {
  let left = count
  for (const s of inv.slots) {
    if (left <= 0) break
    if (s && s.id === id && s.count < maxStack) {
      const n = Math.min(left, maxStack - s.count)
      s.count += n
      left -= n
    }
  }
  for (let i = 0; i < inv.slots.length && left > 0; i++) {
    if (inv.slots[i]) continue
    const n = Math.min(left, maxStack)
    inv.slots[i] = { id, count: n }
    left -= n
  }
  return left
}

/** Remove up to `count` items with this id (last slots first). Returns how many were removed. */
export function removeItems(inv: Inventory, id: string, count: number): number {
  let left = count
  for (let i = inv.slots.length - 1; i >= 0 && left > 0; i--) {
    const s = inv.slots[i]
    if (!s || s.id !== id) continue
    const n = Math.min(left, s.count)
    s.count -= n
    left -= n
    if (s.count <= 0) clearSlot(inv, i)
  }
  return count - left
}

/** Take up to `count` from one slot. Returns the taken stack (or null). */
export function takeFromSlot(inv: Inventory, slot: number, count: number): Stack | null {
  const s = inv.slots[slot]
  if (!s) return null
  const n = Math.min(count, s.count)
  s.count -= n
  if (s.count <= 0) clearSlot(inv, slot)
  return { id: s.id, count: n }
}

export function countItems(inv: Inventory, id: string): number {
  return inv.slots.reduce((n, s) => n + (s && s.id === id ? s.count : 0), 0)
}

/** Swap two slots (or merge into `b` when they hold the same item). Keeps the equipped item in hand. */
export function moveSlot(inv: Inventory, a: number, b: number, maxStack: (id: string) => number): void {
  if (a === b) return
  const sa = inv.slots[a] ?? null
  const sb = inv.slots[b] ?? null
  if (sa && sb && sa.id === sb.id) {
    const room = maxStack(sb.id) - sb.count
    const n = Math.min(room, sa.count)
    sb.count += n
    sa.count -= n
    if (sa.count <= 0) clearSlot(inv, a)
    return
  }
  inv.slots[a] = sb
  inv.slots[b] = sa
  if (inv.equipped === a) inv.equipped = b
  else if (inv.equipped === b) inv.equipped = a
}

export function heldItem(inv: Inventory): string | null {
  return inv.equipped === null ? null : (inv.slots[inv.equipped]?.id ?? null)
}

function clearSlot(inv: Inventory, i: number): void {
  inv.slots[i] = null
  if (inv.equipped === i) inv.equipped = null
}
