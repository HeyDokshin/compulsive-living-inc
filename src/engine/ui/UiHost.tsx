import { render, type ComponentType } from 'preact'
import { signal, computed, effect } from '@preact/signals'
import { useEffect, useRef, useState } from 'preact/hooks'
import { keyCodeOf } from '../input/Input'
import type { Dispose } from '../util/disposables'
import { focusFirst, focusables, moveFocus, nudgeSlider, typingIn, type Dir } from './focus'
import { patternFor, type UiPattern } from './patterns'
import { UI_CSS } from './theme'

/** Places on screen where plugins can put UI. */
export type UiSlot = 'screen' | 'hud.topLeft' | 'hud.topRight' | 'hud.bottomLeft' | 'hud.bottom' | 'hud.bottomRight' | 'hud.center' | 'menu'
/** Slots of the HUD ('menu' is drawn by the Esc menu). 'screen' covers the whole screen under the rest (overlays, bars). */
export const UI_SLOTS: UiSlot[] = ['screen', 'hud.topLeft', 'hud.topRight', 'hud.bottomLeft', 'hud.bottom', 'hud.bottomRight', 'hud.center']

interface SlotEntry {
  key: number
  slot: UiSlot
  order: number
  owner: string
  component: ComponentType
}

export interface WindowDef {
  id: string
  title: string
  component: ComponentType
  /** Pauses player control while open (default true). */
  modal?: boolean
  /** 'dim' (default) blurs the game behind; 'clear' keeps it visible (e.g. a character preview). */
  backdrop?: 'dim' | 'clear'
  /** Where the window sits (default center). */
  align?: 'center' | 'left' | 'right' | 'bottom'
  /** Room for a tool with several columns. */
  wide?: boolean
  /** No frame or title: the component draws all of itself (a phone, a card). */
  bare?: boolean
  /** The quiet pattern behind the window's text (default: one chosen from the id). */
  pattern?: UiPattern
}

const NAV: Record<string, Dir> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Pad12: 'up', Pad13: 'down', Pad14: 'left', Pad15: 'right',
  StickUp: 'up', StickDown: 'down', StickLeft: 'left', StickRight: 'right',
}

interface ToastEntry {
  key: number
  text: string
  icon?: string
  /** On its way out (fading). */
  leaving?: boolean
}

/** Milliseconds things take to leave the screen (windows, toasts): nothing just vanishes. */
const LEAVE_MS = 220


/**
 * Preact UI overlay. Plugins add components to slots and register windows;
 * everything they add is removed automatically when they unload.
 */
export class UiHost {
  private entries = signal<SlotEntry[]>([])
  private windows = signal<Map<string, WindowDef & { owner: string }>>(new Map())
  readonly openId = signal<string | null>(null)
  /** Covers the whole screen (title): the HUD is hidden, windows don't open, game input is paused. */
  readonly cover = signal<{ component: ComponentType; onEscape?: () => void } | null>(null)
  /** The settings are waiting for a key to bind: keys do nothing else. */
  readonly keyCapture = signal(false)
  readonly toasts = signal<ToastEntry[]>([])
  /** True while a modal window is open — gameplay input should pause. */
  readonly modalOpen = computed(() => {
    if (this.cover.value) return true
    const id = this.openId.value
    return !!id && (this.windows.value.get(id)?.modal ?? true)
  })
  private counter = 0
  /** Called when Esc is pressed with no window open (the engine opens its menu). */
  onIdleEscape?: () => void
  /** UI sound hook: 'ui:click', 'ui:open', 'ui:close', 'ui:pop'. */
  onSound?: (id: string) => void
  /** Window opened / closed (the engine turns these into events). */
  onWindow?: (id: string, open: boolean) => void

  private root: HTMLElement | null = null

  /**
   * Menus without a mouse: arrows or the d-pad move between things, Enter / Space / A choose, B goes
   * back, X is the second choice (a right click). True = the key was for the menu.
   */
  navigate(code: string): boolean {
    const root = this.root
    if (!root || !this.modalOpen.value) return false
    const area = root.querySelector('.cl-window') ?? root.querySelector('.cl-title')
    if (!area) return false
    const now = document.activeElement as HTMLElement | null
    const inside = !!now && area.contains(now)
    const typing = inside && typingIn(now)
    const dir = NAV[code]
    if (dir) {
      const pad = code.startsWith('Pad') || code.startsWith('Stick')
      if (typing && !pad) return false // the caret moves
      if (inside && now instanceof HTMLInputElement && now.type === 'range' && (dir === 'left' || dir === 'right')) nudgeSlider(now, dir === 'right' ? 1 : -1)
      else moveFocus(area, dir)
      return true
    }
    if (code === 'Enter' || code === 'Space' || code === 'NumpadEnter' || code === 'Pad0') {
      if (typing && code !== 'Pad0') return false // types, or sends its form
      const text = area.querySelector<HTMLElement>('.cl-dialogue[data-typing]')
      if (text) text.click() // the whole line at once
      else if (inside && focusables(area).includes(now!)) now!.click()
      else focusFirst(area)
      return true
    }
    if (code === 'Pad1') {
      this.back()
      return true
    }
    if (code === 'Pad2' && inside) {
      now!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
      return true
    }
    if (code === 'Pad9' && !this.cover.value) {
      this.close()
      return true
    }
    return code.startsWith('Pad') // nothing else of the pad gets through to the game
  }

  /** Esc or B: out of the window, or the title's own way back. */
  back(): void {
    if (this.cover.value) this.cover.value.onEscape?.()
    else if (this.openId.value) this.close()
    else this.onIdleEscape?.()
  }

  /** Cut-scene mode: the HUD fades out (windows and the 'screen' slot stay). */
  readonly cinema = signal(false)
  /** Everything on the HUD shows, quiet parts included (`ui.Quiet`) — e.g. while the phone is out. */
  readonly peek = signal(false)

  /** A soft fade over the whole screen (after a jump to another place: no hard cut). */
  flash(): void {
    const root = this.root
    if (!root) return
    const veil = document.createElement('div')
    veil.className = 'cl-veil'
    root.appendChild(veil)
    window.setTimeout(() => veil.remove(), 700)
  }

  /** Is a window with this id registered? */
  hasWindow(id: string): boolean {
    return this.windows.value.has(id)
  }

  mount(parent: HTMLElement): void {
    if (!document.getElementById('cl-ui-style')) {
      const style = document.createElement('style')
      style.id = 'cl-ui-style'
      style.textContent = UI_CSS
      document.head.appendChild(style)
    }
    const root = document.createElement('div')
    root.className = 'cl-ui'
    this.root = root
    // a scene is playing: the HUD steps aside (only the 'screen' slot and windows stay)
    effect(() => {
      if (this.cinema.value) root.dataset.cinema = ''
      else delete root.dataset.cinema
    })
    effect(() => {
      if (this.peek.value) root.dataset.peek = ''
      else delete root.dataset.peek
    })
    parent.appendChild(root)
    render(<Root host={this} />, root)
  }

  slot(slot: UiSlot, component: ComponentType, owner: string, order = 0): Dispose {
    const entry: SlotEntry = { key: ++this.counter, slot, order, owner, component }
    this.entries.value = [...this.entries.value, entry].sort((a, b) => a.order - b.order || a.key - b.key)
    return () => {
      this.entries.value = this.entries.value.filter((e) => e !== entry)
    }
  }

  window(def: WindowDef, owner: string): Dispose {
    const map = new Map(this.windows.value)
    map.set(def.id, { ...def, owner })
    this.windows.value = map
    return () => {
      const m = new Map(this.windows.value)
      if (m.get(def.id)?.owner === owner) m.delete(def.id)
      this.windows.value = m
      if (this.openId.value === def.id) this.openId.value = null
    }
  }

  open(id: string): void {
    if (this.cover.value || !this.windows.value.has(id) || this.openId.value === id) return
    const prev = this.openId.value
    this.openId.value = id
    if (prev) this.onWindow?.(prev, false)
    this.onSound?.('ui:open')
    this.onWindow?.(id, true)
  }

  close(): void {
    const id = this.openId.value
    if (!id) return
    this.openId.value = null
    this.onSound?.('ui:close')
    this.onWindow?.(id, false)
  }

  toggle(id: string): void {
    if (this.openId.value === id) this.close()
    else this.open(id)
  }

  toast(text: string, opts: { icon?: string; ms?: number } = {}): void {
    const entry: ToastEntry = { key: ++this.counter, text, icon: opts.icon }
    this.onSound?.('ui:pop')
    this.toasts.value = [...this.toasts.value, entry].slice(-4)
    const ms = opts.ms ?? 2200
    setTimeout(() => {
      this.toasts.value = this.toasts.value.map((t) => (t === entry ? { ...t, leaving: true } : t))
    }, Math.max(0, ms - LEAVE_MS))
    setTimeout(() => {
      this.toasts.value = this.toasts.value.filter((t) => t.key !== entry.key)
    }, ms)
  }

  /** Components put into a slot. */
  inSlot(slot: UiSlot): SlotEntry[] {
    return this.entries.value.filter((e) => e.slot === slot)
  }

  /** For rendering. */
  get allEntries() {
    return this.entries.value
  }
  get openWindow() {
    const id = this.openId.value
    return id ? this.windows.value.get(id) : undefined
  }
}

/** A window on screen: open, or on its way out (`leaving`, not interactive). */
function WindowView({ host, win, leaving }: { host: UiHost; win: WindowDef; leaving?: boolean }) {
  return (
    <div
      class={`cl-backdrop${win.backdrop === 'clear' ? ' clear' : ''}${win.align && win.align !== 'center' ? ' ' + win.align : ''}${leaving ? ' leaving' : ''}`}
      onPointerDown={(e) => !leaving && e.target === e.currentTarget && host.close()}
    >
      {win.bare ? (
        <div class="cl-bare" role="dialog" aria-label={win.title}>
          <win.component />
        </div>
      ) : (
        <div class={`cl-window${win.wide ? ' wide' : ''}`} data-pattern={win.pattern ?? patternFor(win.id)} role="dialog" aria-label={win.title}>
          <div class="cl-window-inner">
            <div class="cl-window-title">
              <span>{win.title}</span>
              <button class="cl-close" aria-label="Закрыть" onClick={() => host.close()}>
                ×
              </button>
            </div>
            <div class="cl-window-body">
              <win.component />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Root({ host }: { host: UiHost }) {
  const entries = host.allEntries
  const win = host.openWindow
  const cover = host.cover.value
  // the window that just closed stays a moment, fading out
  const [gone, setGone] = useState<{ def: WindowDef; key: number } | null>(null)
  const last = useRef<WindowDef | undefined>(undefined)
  useEffect(() => {
    const prev = last.current
    last.current = win
    if (!prev || prev === win) return
    setGone({ def: prev, key: Date.now() })
    const t = window.setTimeout(() => setGone(null), LEAVE_MS)
    return () => window.clearTimeout(t)
  }, [win])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.repeat || host.keyCapture.value) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      // One owner for Esc: close the open window, or (nothing open) ask for the menu.
      host.back()
      e.stopImmediatePropagation()
    }
    const onNav = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || host.keyCapture.value) return
      const code = keyCodeOf(e)
      if (code === 'Tab' && host.cover.value) return e.stopImmediatePropagation() // the browser's own way around
      if (e.repeat && !(code in NAV)) return
      if (!host.navigate(code)) return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    const onClick = (e: PointerEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('.cl-ui button, .cl-ui .cl-slotbox')) host.onSound?.('ui:click')
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keydown', onNav, true)
    window.addEventListener('pointerdown', onClick, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keydown', onNav, true)
      window.removeEventListener('pointerdown', onClick, true)
    }
  }, [host])
  if (cover) return <cover.component />
  return (
    <>
      {UI_SLOTS.map((slot) => (
        <div key={slot} class={`cl-slot cl-slot-${slot}`}>
          {entries
            .filter((e) => e.slot === slot)
            .map((e) => (
              <e.component key={e.key} />
            ))}
        </div>
      ))}
      {gone && gone.def !== win && <WindowView key={`gone-${gone.key}`} host={host} win={gone.def} leaving />}
      {win && <WindowView key={win.id} host={host} win={win} />}
      <div class="cl-toasts">
        {host.toasts.value.map((t) => (
          <div key={t.key} class={`cl-toast${t.leaving ? ' leaving' : ''}`}>
            {t.icon && <img src={t.icon} alt="" />}
            {t.text}
          </div>
        ))}
      </div>
    </>
  )
}
