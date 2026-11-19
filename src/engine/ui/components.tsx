/** Small UI building blocks shared by all plugins (exported from '@sdk' as `ui`). */
import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'

export function Pill({ children }: { children: ComponentChildren }) {
  return <div class="cl-pill">{children}</div>
}

/** Keyboard/gamepad key cap. */
export function Key({ children }: { children: ComponentChildren }) {
  return <span class="cl-key">{children}</span>
}

export function Button(props: { children: ComponentChildren; onClick?: () => void; secondary?: boolean; disabled?: boolean }) {
  return (
    <button class={`cl-btn${props.secondary ? ' secondary' : ''}`} disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  )
}

/** An icon that may still be loading (`Promise<string>` from `api.ui.itemIcon`). */
export function AsyncIcon({ src, size = 48, alt = '' }: { src: Promise<string> | string | undefined; size?: number; alt?: string }) {
  const [url, setUrl] = useState(typeof src === 'string' ? src : '')
  useEffect(() => {
    let alive = true
    if (typeof src === 'string') setUrl(src)
    else src?.then((u) => alive && setUrl(u))
    return () => {
      alive = false
    }
  }, [src])
  return url ? <img src={url} width={size} height={size} alt={alt} style={{ imageRendering: 'pixelated' }} /> : <span style={{ width: size, height: size }} />
}

export function ItemSlot(props: {
  icon?: Promise<string> | string
  count?: number
  title?: string
  selected?: boolean
  equipped?: boolean
  onClick?: () => void
  onContextMenu?: () => void
}) {
  const cls = ['cl-slotbox', props.selected && 'selected', props.equipped && 'equipped'].filter(Boolean).join(' ')
  return (
    <div
      class={cls}
      title={props.title}
      onClick={props.onClick}
      onContextMenu={(e) => {
        if (props.onContextMenu) {
          e.preventDefault()
          props.onContextMenu()
        }
      }}
    >
      {props.icon && <AsyncIcon src={props.icon} />}
      {props.count !== undefined && props.count > 1 && <span class="cl-count">{props.count}</span>}
    </div>
  )
}

export function Grid({ columns, children }: { columns: number; children: ComponentChildren }) {
  return (
    <div class="cl-grid" style={{ gridTemplateColumns: `repeat(${columns}, 64px)` }}>
      {children}
    </div>
  )
}
