import { useEffect, useState } from 'preact/hooks'
import type { Game } from '../Game'
import { formatDate, formatTime, SEASON_ICONS, SEASON_NAMES } from './calendar'

/** HUD clock: the time large, the date and season under it — a quiet corner of the screen. */
export function Clock({ game }: { game: Game }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  if (!game.engineConfig.debug.showClock) return null
  const g = game.time.now()
  return (
    <div class="cl-clock">
      <div class="cl-clock-time">{formatTime(g)}</div>
      <div class="cl-clock-date">
        <span title={SEASON_NAMES[g.season]}>{SEASON_ICONS[g.season]}</span>
        <span>{formatDate(g)}</span>
      </div>
    </div>
  )
}
