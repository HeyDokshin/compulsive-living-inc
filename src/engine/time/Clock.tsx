import { useEffect, useState } from 'preact/hooks'
import type { Game } from '../Game'
import { Pill } from '../ui/components'
import { formatDate, formatTime, SEASON_ICONS, SEASON_NAMES } from './calendar'

/** HUD clock: weekday, date, time and season. */
export function Clock({ game }: { game: Game }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  if (!game.engineConfig.debug.showClock) return null
  const g = game.time.now()
  return (
    <Pill>
      <span title={SEASON_NAMES[g.season]}>{SEASON_ICONS[g.season]}</span>
      <span>{formatDate(g)}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--ui-text-soft)' }}>{formatTime(g)}</span>
    </Pill>
  )
}
