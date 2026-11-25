/** Moving around windows with arrow keys or a gamepad: the nearest thing in a direction. */
export type Dir = 'up' | 'down' | 'left' | 'right'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Index of the box to go to from `from`, or -1. Things straight ahead win over nearer ones aside:
 * the sideways gap counts several times.
 */
export function nextBox(from: Box, boxes: readonly Box[], dir: Dir): number {
  const horizontal = dir === 'left' || dir === 'right'
  const sign = dir === 'left' || dir === 'up' ? -1 : 1
  const lo = (b: Box, axis: 'x' | 'y') => b[axis]
  const hi = (b: Box, axis: 'x' | 'y') => b[axis] + (axis === 'x' ? b.w : b.h)
  const main = horizontal ? 'x' : 'y'
  const cross = horizontal ? 'y' : 'x'
  const mid = (b: Box, axis: 'x' | 'y') => (lo(b, axis) + hi(b, axis)) / 2
  let best = -1
  let bestScore = Infinity
  boxes.forEach((b, i) => {
    const ahead = (mid(b, main) - mid(from, main)) * sign
    if (ahead <= 1) return
    const gap = Math.max(0, sign > 0 ? lo(b, main) - hi(from, main) : lo(from, main) - hi(b, main))
    const aside = Math.max(0, lo(b, cross) - hi(from, cross), lo(from, cross) - hi(b, cross))
    const score = gap + aside * 4 + Math.abs(mid(b, cross) - mid(from, cross)) * 0.2
    if (score < bestScore) {
      bestScore = score
      best = i
    }
  })
  return best
}

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), .cl-slotbox'

/** Things that can be chosen in the open window (or title screen). */
export function focusables(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.offsetParent !== null || e.getClientRects().length > 0)
}

const boxOf = (e: Element): Box => {
  const r = e.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height }
}

/** Move the focus; with nothing focused, take the first thing (not the close button). */
export function moveFocus(root: ParentNode, dir: Dir): void {
  const list = focusables(root)
  if (!list.length) return
  const now = document.activeElement as HTMLElement | null
  const at = now ? list.indexOf(now) : -1
  if (at < 0) return focusFirst(root)
  const others = list.filter((_, i) => i !== at)
  const to = others[nextBox(boxOf(list[at]!), others.map(boxOf), dir)]
  if (!to) return
  to.focus()
  to.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

export function focusFirst(root: ParentNode): void {
  const list = focusables(root)
  const first = list.find((e) => !e.classList.contains('cl-close')) ?? list[0]
  first?.focus()
}

/** Is the caret in a text field (arrows and Enter belong to it)? */
export function typingIn(e: Element | null): boolean {
  if (!e) return false
  if (e.tagName === 'TEXTAREA' || e.tagName === 'SELECT') return true
  return e.tagName === 'INPUT' && !['checkbox', 'range', 'color', 'button'].includes((e as HTMLInputElement).type)
}

/** Left / right on a slider: move it like its own keys would. */
export function nudgeSlider(e: HTMLInputElement, dir: 1 | -1): void {
  if (dir > 0) e.stepUp()
  else e.stepDown()
  e.dispatchEvent(new Event('input', { bubbles: true }))
}
