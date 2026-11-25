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
    <button type="button" class={`cl-btn${props.secondary ? ' secondary' : ''}`} disabled={props.disabled} onClick={props.onClick}>
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

/**
 * A character speaking: the text types itself out (click to show it all), `onBlip` is called every
 * couple of letters (play a voice note there), `onTyping` while it types (nod the speaker).
 * `children` — the answers — appear once the text is done.
 */
export function Dialogue(props: {
  speaker: string
  text: string
  /** Seconds per character. */
  typeSpeed?: number
  onBlip?: () => void
  onTyping?: (typing: boolean) => void
  children?: ComponentChildren
}) {
  const { text, typeSpeed = 0.028 } = props
  const [shown, setShown] = useState(0)
  const [skipped, setSkipped] = useState(false)
  useEffect(() => {
    setShown(0)
    setSkipped(false)
    props.onTyping?.(true)
    let i = 0
    const timer = window.setInterval(() => {
      i++
      setShown(i)
      if (i % 2 === 0 && /\p{L}/u.test(text[i - 1] ?? '')) props.onBlip?.()
      if (i >= text.length) {
        window.clearInterval(timer)
        props.onTyping?.(false)
      }
    }, typeSpeed * 1000)
    return () => {
      window.clearInterval(timer)
      props.onTyping?.(false)
    }
  }, [text])
  const typing = !skipped && shown < text.length
  const skip = () => {
    setSkipped(true)
    props.onTyping?.(false)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div class="cl-dialogue" onClick={skip} style={{ cursor: typing ? 'pointer' : 'default' }}>
        <div class="cl-dialogue-speaker">{props.speaker}</div>
        {typing ? text.slice(0, shown) : text}
        {typing && <span style={{ opacity: 0.4 }}>▍</span>}
      </div>
      {!typing && props.children}
    </div>
  )
}

/** Answer buttons under a `Dialogue`: the first is the main one. */
export function Choices({ items }: { items: Array<[string, () => void] | false | null | undefined> }) {
  const list = items.filter(Boolean) as Array<[string, () => void]>
  return (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {list.map(([label, run], i) => (
        <Button key={label} secondary={i > 0} onClick={run}>
          {label}
        </Button>
      ))}
    </div>
  )
}
