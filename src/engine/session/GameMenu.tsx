import { useState } from 'preact/hooks'
import type { Game } from '../Game'
import { Button } from '../ui/components'
import { SavesTab } from './SavesTab'
import { SettingsTab } from './SettingsTab'

const TABS = [
  { id: 'saves', label: 'Острова' },
  { id: 'settings', label: 'Настройки' },
] as const

/** Esc menu with tabs. */
export function GameMenu({ game }: { game: Game }) {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('saves')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: 'min(600px, 84vw)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: '6px', background: 'var(--ui-bg-2)', padding: '4px', borderRadius: '999px', alignSelf: 'flex-start' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            class={`cl-btn${tab === t.id ? '' : ' secondary'}`}
            style={{ boxShadow: 'none', padding: '6px 16px' }}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
        <Button secondary onClick={() => void game.title.leaveGame()}>
          Главное меню
        </Button>
      </div>
      {tab === 'saves' ? <SavesTab game={game} /> : <SettingsTab game={game} />}
    </div>
  )
}
