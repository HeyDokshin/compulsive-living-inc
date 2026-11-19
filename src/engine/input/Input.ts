import type { Dispose } from '../util/disposables'

const KEY_TO_CODE: Record<string, string> = {
  '`': 'Backquote', '~': 'Backquote', 'ё': 'Backquote', 'Ё': 'Backquote',
  ' ': 'Space', Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Shift: 'ShiftLeft', Control: 'ControlLeft',
  ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
}

/** Physical key code; falls back to `key` for synthetic/virtual keyboards that leave `code` empty. */
export function keyCodeOf(e: KeyboardEvent): string {
  if (e.code) return e.code
  const k = e.key
  if (KEY_TO_CODE[k]) return KEY_TO_CODE[k]
  if (/^[a-z]$/i.test(k)) return 'Key' + k.toUpperCase()
  if (/^[0-9]$/.test(k)) return 'Digit' + k
  if (/^F\d{1,2}$/.test(k)) return k
  return k
}

export interface ActionDef {
  id: string
  owner: string
  /** `KeyboardEvent.code` values (`KeyW`, `ArrowUp`, `Space`) or `Mouse0`/`Mouse1`/`Mouse2`. */
  keys: string[]
}

/**
 * Actions instead of raw keys: systems ask `isDown('camera:rotateLeft')`,
 * bindings live in config and can be rebound without touching code.
 */
export class Input {
  private actions = new Map<string, ActionDef>()
  private overrides = new Map<string, string[]>()
  private down = new Set<string>()
  private pressed = new Set<string>()
  private listeners = new Map<string, Set<() => void>>()
  private wheel = 0
  private detach: Dispose = () => {}
  private pressFn?: (code: string) => void
  private padDown = new Set<string>()
  /** Left stick of the first gamepad, deadzone applied (x right, y down). */
  readonly stick = { x: 0, y: 0 }
  deadzone = 0.22

  define(id: string, keys: string[], owner: string): Dispose {
    this.actions.set(id, { id, owner, keys })
    return () => {
      if (this.actions.get(id)?.owner === owner) this.actions.delete(id)
    }
  }

  /** User/config rebinding. */
  rebind(id: string, keys: string[]): void {
    this.overrides.set(id, keys)
  }

  keysOf(id: string): string[] {
    return this.overrides.get(id) ?? this.actions.get(id)?.keys ?? []
  }

  list(): ActionDef[] {
    return [...this.actions.values()].map((a) => ({ ...a, keys: this.keysOf(a.id) }))
  }

  isDown(action: string): boolean {
    return this.keysOf(action).some((k) => this.down.has(k))
  }

  /** True during the tick after the key went down. */
  wasPressed(action: string): boolean {
    return this.keysOf(action).some((k) => this.pressed.has(k))
  }

  /** Immediate callback on press (UI-style actions: open console, rotate camera). */
  on(action: string, fn: () => void): Dispose {
    let set = this.listeners.get(action)
    if (!set) this.listeners.set(action, (set = new Set()))
    set.add(fn)
    return () => set!.delete(fn)
  }

  /** Wheel delta accumulated since the last call. */
  consumeWheel(): number {
    const w = this.wheel
    this.wheel = 0
    return w
  }

  endTick(): void {
    this.pressed.clear()
  }

  /**
   * Read the first connected gamepad (call once per tick). Buttons become codes `Pad0`, `Pad1`…
   * (standard mapping: Pad0 = A/Cross, Pad1 = B/Circle, Pad12–15 = d-pad), usable in bindings.
   */
  pollGamepad(): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []
    const pad = [...pads].find((p) => p?.connected)
    this.stick.x = this.stick.y = 0
    const now = new Set<string>()
    if (pad) {
      const [ax = 0, ay = 0] = pad.axes
      const mag = Math.hypot(ax, ay)
      if (mag > this.deadzone) {
        const k = Math.min(1, (mag - this.deadzone) / (1 - this.deadzone)) / mag
        this.stick.x = ax * k
        this.stick.y = ay * k
      }
      pad.buttons.forEach((b, i) => b.pressed && now.add(`Pad${i}`))
    }
    for (const code of now) if (!this.padDown.has(code)) this.pressFn?.(code)
    for (const code of this.padDown) if (!now.has(code)) this.down.delete(code)
    this.padDown = now
  }

  attach(target: HTMLElement): void {
    const isTyping = (e: Event) => {
      const t = e.target as HTMLElement | null
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    }
    const press = (code: string, e?: Event) => {
      if (!this.down.has(code)) {
        this.pressed.add(code)
        for (const [action, fns] of this.listeners) {
          if (this.keysOf(action).includes(code)) {
            for (const fn of [...fns]) fn()
            e?.preventDefault()
          }
        }
      }
      this.down.add(code)
    }
    this.pressFn = press
    const kd = (e: KeyboardEvent) => {
      const code = keyCodeOf(e)
      if (isTyping(e) && code !== 'Backquote') return
      press(code, e)
    }
    const ku = (e: KeyboardEvent) => this.down.delete(keyCodeOf(e))
    const md = (e: MouseEvent) => press(`Mouse${e.button}`, e)
    const mu = (e: MouseEvent) => this.down.delete(`Mouse${e.button}`)
    const wh = (e: WheelEvent) => {
      this.wheel += e.deltaY
      e.preventDefault()
    }
    const blur = () => this.down.clear()
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    window.addEventListener('blur', blur)
    target.addEventListener('mousedown', md)
    window.addEventListener('mouseup', mu)
    target.addEventListener('wheel', wh, { passive: false })
    this.detach = () => {
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
      window.removeEventListener('blur', blur)
      target.removeEventListener('mousedown', md)
      window.removeEventListener('mouseup', mu)
      target.removeEventListener('wheel', wh)
    }
  }

  dispose(): void {
    this.detach()
  }
}
