import { describe, expect, it } from 'vitest'
import { addItems, countItems, createInventory, heldItem, moveSlot, removeItems, takeFromSlot } from '../src/plugins/items/inventory'

describe('inventory', () => {
  it('stacks, overflows and reports what did not fit', () => {
    const inv = createInventory(3)
    expect(addItems(inv, 'a', 12, 10)).toBe(0)
    expect(inv.slots.map((s) => s?.count)).toEqual([10, 2, undefined])
    expect(addItems(inv, 'a', 3, 10)).toBe(0)
    expect(inv.slots[1]!.count).toBe(5)
    expect(addItems(inv, 'b', 25, 10)).toBe(15)
    expect(countItems(inv, 'a')).toBe(15)
  })

  it('removes from the end and clears the hands when the held stack runs out', () => {
    const inv = createInventory(3)
    addItems(inv, 'a', 3, 10)
    addItems(inv, 'tool', 1, 1)
    inv.equipped = 1
    expect(heldItem(inv)).toBe('tool')
    expect(removeItems(inv, 'tool', 5)).toBe(1)
    expect(heldItem(inv)).toBe(null)
    expect(takeFromSlot(inv, 0, 2)).toEqual({ id: 'a', count: 2 })
    expect(inv.slots[0]!.count).toBe(1)
  })

  it('swaps or merges slots and keeps the equipped item in hand', () => {
    const inv = createInventory(3)
    addItems(inv, 'tool', 1, 1)
    addItems(inv, 'a', 4, 10)
    inv.equipped = 0
    moveSlot(inv, 0, 2, () => 10)
    expect(inv.slots[2]!.id).toBe('tool')
    expect(inv.equipped).toBe(2)
    inv.slots[0] = { id: 'a', count: 8 }
    moveSlot(inv, 1, 0, () => 10) // merge 4 into 8 → 10 + 2 left
    expect(inv.slots[0]!.count).toBe(10)
    expect(inv.slots[1]!.count).toBe(2)
  })
})
