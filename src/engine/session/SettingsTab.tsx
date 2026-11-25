import { useEffect, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import type { Game } from '../Game'
import { keyCodeOf } from '../input/Input'
import { isPadCode, keyName, withKey } from '../input/keyNames'
import { Button, Key } from '../ui/components'
import { UI_SCALES, loadUserSettings, updateUserSettings, type Quality, type UserSettings } from './settings'

const QUALITY: Array<{ id: Quality; label: string; hint: string }> = [
  { id: 'low', label: 'Низкое', hint: 'без теней и эффектов, ровный мир' },
  { id: 'medium', label: 'Среднее', hint: 'мягкие тени, эффекты' },
  { id: 'high', label: 'Высокое', hint: 'всё на максимум' },
]

const PAGES = [
  ['picture', 'Картинка'],
  ['sound', 'Звук'],
  ['interface', 'Интерфейс'],
  ['keys', 'Управление'],
] as const

function Row({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', minHeight: '38px', flexWrap: 'wrap' }}>
      <span style={{ fontWeight: 700 }}>{label}</span>
      {children}
    </div>
  )
}

/** Menu tab «Настройки»: picture, sound, interface, keys — stored per device, not in saves. */
export function SettingsTab({ game }: { game: Game }) {
  const [s, setS] = useState<UserSettings>(loadUserSettings)
  const [page, setPage] = useState<(typeof PAGES)[number][0]>('picture')
  const set = (patch: Partial<UserSettings>) => setS(updateUserSettings(game, patch))
  const slider = (key: 'master' | 'sfx' | 'ui' | 'ambient' | 'music', label: string) => (
    <input
      type="range"
      min={0}
      max={1}
      step={0.05}
      value={s[key]}
      aria-label={label}
      style={{ width: '220px', accentColor: 'var(--ui-accent)' }}
      onInput={(e) => set({ [key]: Number((e.target as HTMLInputElement).value) })}
    />
  )
  const check = (key: 'muted' | 'showFps' | 'cameraShake' | 'instantText', label: string) => (
    <input
      type="checkbox"
      checked={s[key]}
      aria-label={label}
      style={{ width: '20px', height: '20px', accentColor: 'var(--ui-accent)' }}
      onChange={(e) => set({ [key]: (e.target as HTMLInputElement).checked })}
    />
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '480px' }}>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '4px' }}>
        {PAGES.map(([id, label]) => (
          <Button key={id} secondary={page !== id} onClick={() => setPage(id)}>
            {label}
          </Button>
        ))}
      </div>
      {page === 'picture' && (
        <>
          <Row label="Качество графики">
            <div style={{ display: 'flex', gap: '6px' }}>
              {QUALITY.map((q) => (
                <Button key={q.id} secondary={s.quality !== q.id} onClick={() => set({ quality: q.id })}>
                  {q.label}
                </Button>
              ))}
            </div>
          </Row>
          <div style={{ color: 'var(--ui-text-soft)', fontSize: '13px', textAlign: 'right', marginTop: '-4px' }}>{QUALITY.find((q) => q.id === s.quality)?.hint}</div>
          <Row label="Тряска камеры">{check('cameraShake', 'Тряска камеры')}</Row>
          <Row label="Показывать FPS">{check('showFps', 'Показывать FPS')}</Row>
        </>
      )}
      {page === 'sound' && (
        <>
          <Row label="Общая громкость">{slider('master', 'Общая громкость')}</Row>
          <Row label="Звуки мира">{slider('sfx', 'Звуки мира')}</Row>
          <Row label="Музыка">{slider('music', 'Музыка')}</Row>
          <Row label="Природа (прибой, птицы)">{slider('ambient', 'Природа')}</Row>
          <Row label="Звуки интерфейса">{slider('ui', 'Звуки интерфейса')}</Row>
          <Row label="Без звука">{check('muted', 'Без звука')}</Row>
        </>
      )}
      {page === 'interface' && (
        <>
          <Row label="Размер интерфейса">
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {UI_SCALES.map((k) => (
                <Button key={k} secondary={s.uiScale !== k} onClick={() => set({ uiScale: k })}>
                  {Math.round(k * 100)}%
                </Button>
              ))}
            </div>
          </Row>
          <Row label="Реплики сразу целиком">{check('instantText', 'Реплики сразу целиком')}</Row>
        </>
      )}
      {page === 'keys' && <Keys game={game} bindings={s.bindings} set={(bindings) => set({ bindings })} />}
      <div style={{ color: 'var(--ui-text-soft)', fontSize: '12px', marginTop: '6px' }}>Настройки хранятся в этом браузере и не зависят от сохранений.</div>
    </div>
  )
}

/** Key bindings: choose an action, press its new key. A key taken from another action leaves that one without it. */
function Keys({ game, bindings, set }: { game: Game; bindings: Record<string, string[]>; set(b: Record<string, string[]>): void }) {
  const [waiting, setWaiting] = useState<string | null>(null)
  const [note, setNote] = useState('')
  // walking and acting first, the engine's own last
  const rank = (owner: string) => (owner === 'player' ? 0 : owner === 'engine' ? 2 : 1)
  const actions = game.input
    .list()
    .filter((a) => a.label)
    .sort((a, b) => rank(a.owner) - rank(b.owner))
  useEffect(() => {
    if (!waiting) return
    game.ui.keyCapture.value = true
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      const code = keyCodeOf(e)
      setWaiting(null)
      if (code === 'Escape') return
      const me = actions.find((a) => a.id === waiting)!
      const next = { ...bindings, [me.id]: withKey(me.keys, code) }
      const loser = actions.find((a) => a.id !== me.id && a.keys.includes(code))
      if (loser) next[loser.id] = loser.keys.filter((k) => k !== code)
      set(next)
      setNote(loser ? `Клавиша «${keyName(code)}» была у «${loser.label}» — там её больше нет.` : '')
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      game.ui.keyCapture.value = false
      window.removeEventListener('keydown', onKey, true)
    }
  }, [waiting])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ maxHeight: '46vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {actions.map((a) => {
          const keys = [...new Set(a.keys.filter((k) => !isPadCode(k)).map(keyName))]
          const pad = a.keys.filter(isPadCode)
          return (
            <button key={a.id} class="cl-row" aria-pressed={waiting === a.id} onClick={() => (setWaiting(a.id), setNote(''))}>
              <span style={{ flex: 1 }}>{a.label}</span>
              {waiting === a.id ? (
                <span style={{ color: 'var(--ui-accent)' }}>Нажмите клавишу… (Esc — отмена)</span>
              ) : (
                <>
                  {keys.length ? keys.map((k) => <Key key={k}>{k}</Key>) : <span style={{ color: '#c96f4a', fontSize: '12px' }}>нет клавиши</span>}
                  {pad.length > 0 && <span style={{ color: 'var(--ui-text-soft)', fontSize: '12px' }}>🎮 {pad.map(keyName).join(', ')}</span>}
                </>
              )}
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
        <span style={{ fontSize: '12px', color: 'var(--ui-text-soft)' }}>{note || 'Нажмите на действие, потом на новую клавишу.'}</span>
        <Button secondary disabled={!Object.keys(bindings).length} onClick={() => (set({}), setNote(''))}>
          Сбросить
        </Button>
      </div>
    </div>
  )
}
