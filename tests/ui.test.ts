import { describe, expect, it } from 'vitest'
import { keyName, shownKey, withKey } from '../src/engine/input/keyNames'
import { nextBox, type Box } from '../src/engine/ui/focus'
import { wrapText } from '../src/plugins/emotes/bubble'

describe('key names and bindings', () => {
  it('names keys and shows the one of the device in use', () => {
    expect(['KeyW', 'Digit1', 'Space', 'ArrowUp', 'Mouse0', 'Pad0', 'Pad12'].map(keyName)).toEqual(['W', '1', 'Пробел', '↑', 'ЛКМ', 'A', '✚↑'])
    expect(shownKey(['Space', 'Pad0'], 'keyboard')).toBe('Space')
    expect(shownKey(['Space', 'Pad0'], 'gamepad')).toBe('Pad0')
    expect(shownKey(['KeyC'], 'gamepad')).toBe('KeyC')
    expect(shownKey([], 'keyboard')).toBeUndefined()
  })
  it('replaces keyboard keys and keeps the pad and the mouse', () => {
    expect(withKey(['Space', 'Enter', 'Pad0'], 'KeyX')).toEqual(['KeyX', 'Pad0'])
    expect(withKey(['Mouse0'], 'KeyX')).toEqual(['KeyX', 'Mouse0'])
  })
})

describe('moving around a window', () => {
  // a 3 × 2 grid of slots with a button under it on the right
  const grid: Box[] = [0, 1, 2, 3, 4, 5].map((i) => ({ x: (i % 3) * 72, y: Math.floor(i / 3) * 72, w: 64, h: 64 }))
  const button: Box = { x: 120, y: 160, w: 90, h: 36 }
  const go = (from: Box, dir: 'up' | 'down' | 'left' | 'right') => {
    const others = [...grid, button].filter((b) => b !== from)
    return others[nextBox(from, others, dir)]
  }
  it('goes to the neighbour straight ahead', () => {
    expect(go(grid[0]!, 'right')).toBe(grid[1])
    expect(go(grid[0]!, 'down')).toBe(grid[3])
    expect(go(grid[4]!, 'up')).toBe(grid[1])
    expect(go(grid[5]!, 'left')).toBe(grid[4])
    expect(go(grid[5]!, 'down')).toBe(button)
    expect(go(button, 'up')).toBe(grid[5])
  })
  it('stays when nothing is there', () => {
    expect(go(grid[2]!, 'right')).toBeUndefined()
    expect(go(grid[0]!, 'up')).toBeUndefined()
  })
})

describe('speech bubbles', () => {
  it('break lines between words', () => {
    const width = (s: string) => s.length
    expect(wrapText('Привет, Аня! Как дела сегодня?', 14, width)).toEqual(['Привет, Аня!', 'Как дела', 'сегодня?'])
    expect(wrapText('оченьдлинноеслово да', 8, width)).toEqual(['оченьдлинноеслово', 'да'])
    expect(wrapText('  ', 8, width)).toEqual([])
  })
})
