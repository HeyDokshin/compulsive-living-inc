import { useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import type { Game } from '../Game'
import { loadUserSettings, updateUserSettings, type Quality, type UserSettings } from './settings'

const QUALITY: Array<{ id: Quality; label: string; hint: string }> = [
  { id: 'low', label: 'Низкое', hint: 'без теней и эффектов, ровный мир' },
  { id: 'medium', label: 'Среднее', hint: 'мягкие тени, эффекты' },
  { id: 'high', label: 'Высокое', hint: 'всё на максимум' },
]

function Row({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', minHeight: '38px' }}>
      <span style={{ fontWeight: 700 }}>{label}</span>
      {children}
    </div>
  )
}

/** Menu tab «Настройки»: quality and sound — stored per device, not in saves. */
export function SettingsTab({ game }: { game: Game }) {
  const [s, setS] = useState<UserSettings>(loadUserSettings)
  const set = (patch: Partial<UserSettings>) => setS(updateUserSettings(game, patch))
  const slider = (key: 'master' | 'sfx' | 'ui' | 'ambient' | 'music') => (
    <input
      type="range"
      min={0}
      max={1}
      step={0.05}
      value={s[key]}
      style={{ width: '220px', accentColor: 'var(--ui-accent)' }}
      onInput={(e) => set({ [key]: Number((e.target as HTMLInputElement).value) })}
    />
  )
  const check = (key: 'muted' | 'showFps' | 'cameraShake') => (
    <input
      type="checkbox"
      checked={s[key]}
      style={{ width: '20px', height: '20px', accentColor: 'var(--ui-accent)' }}
      onChange={(e) => set({ [key]: (e.target as HTMLInputElement).checked })}
    />
  )
  const current = QUALITY.find((q) => q.id === s.quality)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <Row label="Качество графики">
        <div style={{ display: 'flex', gap: '6px' }}>
          {QUALITY.map((q) => (
            <button key={q.id} class={`cl-btn${s.quality === q.id ? '' : ' secondary'}`} onClick={() => set({ quality: q.id })}>
              {q.label}
            </button>
          ))}
        </div>
      </Row>
      <div style={{ color: 'var(--ui-text-soft)', fontSize: '13px', textAlign: 'right', marginTop: '-4px' }}>{current?.hint}</div>
      <Row label="Общая громкость">{slider('master')}</Row>
      <Row label="Звуки мира">{slider('sfx')}</Row>
      <Row label="Музыка">{slider('music')}</Row>
      <Row label="Природа (прибой, птицы)">{slider('ambient')}</Row>
      <Row label="Звуки интерфейса">{slider('ui')}</Row>
      <Row label="Без звука">{check('muted')}</Row>
      <Row label="Показывать FPS">{check('showFps')}</Row>
      <Row label="Тряска камеры">{check('cameraShake')}</Row>
      <div style={{ color: 'var(--ui-text-soft)', fontSize: '12px', marginTop: '6px' }}>
        Настройки хранятся в этом браузере и не зависят от сохранений.
      </div>
    </div>
  )
}
