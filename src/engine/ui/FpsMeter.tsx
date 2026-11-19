import { useEffect, useState } from 'preact/hooks'
import type { Game } from '../Game'
import { Pill } from './components'

/** Small frames-per-second counter (Esc → Настройки → «Показывать FPS»). */
export function FpsMeter({ game }: { game: Game }) {
  const [fps, setFps] = useState(0)
  const [show, setShow] = useState(game.engineConfig.debug.showFps)
  useEffect(() => {
    let frames = 0
    let last = performance.now()
    let raf = 0
    const tick = (now: number) => {
      frames++
      if (now - last >= 500) {
        setFps(Math.round((frames * 1000) / (now - last)))
        setShow(game.engineConfig.debug.showFps)
        frames = 0
        last = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [game])
  if (!show) return null
  return (
    <Pill>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fps} FPS</span>
    </Pill>
  )
}
