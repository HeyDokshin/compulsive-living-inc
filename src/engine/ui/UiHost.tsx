import { render, type ComponentType } from 'preact'
import { signal, computed } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import type { Dispose } from '../util/disposables'
import { UI_CSS } from './theme'

/** Places on screen where plugins can put UI. */
export type UiSlot = 'hud.topLeft' | 'hud.topRight' | 'hud.bottomLeft' | 'hud.bottom' | 'hud.bottomRight' | 'hud.center'
export const UI_SLOTS: UiSlot[] = ['hud.topLeft', 'hud.topRight', 'hud.bottomLeft', 'hud.bottom', 'hud.bottomRight', 'hud.center']

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
}

interface ToastEntry {
  key: number
  text: string
  icon?: string
}

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

  mount(parent: HTMLElement): void {
    if (!document.getElementById('cl-ui-style')) {
      const style = document.createElement('style')
      style.id = 'cl-ui-style'
      style.textContent = UI_CSS
      document.head.appendChild(style)
    }
    const root = document.createElement('div')
    root.className = 'cl-ui'
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
    setTimeout(() => {
      this.toasts.value = this.toasts.value.filter((t) => t !== entry)
    }, opts.ms ?? 2200)
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

function Root({ host }: { host: UiHost }) {
  const entries = host.allEntries
  const win = host.openWindow
  const cover = host.cover.value
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.repeat) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      // One owner for Esc: close the open window, or (nothing open) ask for the menu.
      if (host.cover.value) host.cover.value.onEscape?.()
      else if (host.openId.value) host.close()
      else host.onIdleEscape?.()
      e.stopImmediatePropagation()
    }
    const onClick = (e: PointerEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('.cl-ui button, .cl-ui .cl-slotbox')) host.onSound?.('ui:click')
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onClick, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
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
      {win && (
        <div
          class={`cl-backdrop${win.backdrop === 'clear' ? ' clear' : ''}${win.align && win.align !== 'center' ? ' ' + win.align : ''}`}
          onPointerDown={(e) => e.target === e.currentTarget && host.close()}
        >
          <div class="cl-window" role="dialog" aria-label={win.title}>
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
      <div class="cl-toasts">
        {host.toasts.value.map((t) => (
          <div key={t.key} class="cl-toast">
            {t.icon && <img src={t.icon} alt="" />}
            {t.text}
          </div>
        ))}
      </div>
    </>
  )
}
