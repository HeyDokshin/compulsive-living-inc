import { useEffect, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import type { Game } from '../Game'
import type { SaveMeta } from '../save/format'
import { Button } from '../ui/components'
import { GAME_VERSION } from '../version'
import { MAX_NAME, cleanName, parseSeed } from './names'
import { ModsTab } from './ModsTab'
import { SavesTab, fmtTime } from './SavesTab'
import { DEFAULT_ISLAND } from './SessionManager'
import { SettingsTab } from './SettingsTab'

const TITLES = { main: '', new: 'Новый остров', islands: 'Острова', mods: 'Моды', settings: 'Настройки' }

/** The title screen: logo and menu on the left, the chosen page as a panel beside it. */
export function TitleScreen({ game }: { game: Game }) {
  const t = game.title
  const view = t.view.value
  const [metas, setMetas] = useState<SaveMeta[] | null>(null)
  useEffect(() => {
    game.sessions.storage.list().then(setMetas, () => setMetas([]))
  }, [view, game])
  const latest = metas?.[0]
  const go = (v: typeof view) => () => (t.view.value = t.view.value === v ? 'main' : v)

  return (
    <div class="cl-title">
      <div class="cl-title-side">
        <h1 class="cl-title-logo">
          Compulsive
          <br />
          Living
        </h1>
        {t.busy.value ? (
          <div class="cl-title-busy">
            <span class="cl-title-dots">
              <i />
              <i />
              <i />
            </span>
            {t.busy.value}
          </div>
        ) : (
          <div class="cl-title-menu">
            {latest && (
              <button class="cl-title-btn main" onClick={() => void t.resume(latest.slot)}>
                Продолжить
                <small>{[latest.name, latest.player, fmtTime(latest.playTime)].filter(Boolean).join(' · ')}</small>
              </button>
            )}
            {metas && (
              <button class={`cl-title-btn${latest ? '' : ' main'}${view === 'new' ? ' on' : ''}`} onClick={go('new')}>
                Новый остров
              </button>
            )}
            <button class={`cl-title-btn${view === 'islands' ? ' on' : ''}`} onClick={go('islands')}>
              Острова
            </button>
            <button class={`cl-title-btn${view === 'mods' ? ' on' : ''}`} onClick={go('mods')}>
              Моды{game.mods.list().some((m) => m.enabled && m.errors.length) ? ' ⚠️' : ''}
            </button>
            <button class={`cl-title-btn${view === 'settings' ? ' on' : ''}`} onClick={go('settings')}>
              Настройки
            </button>
          </div>
        )}
        {game.mods.safeMode && <div class="cl-pill">Прошлый запуск с модами не завершился — сейчас они выключены. Проверьте раздел «Моды».</div>}
        {t.note.value && <div class="cl-pill">{t.note.value}</div>}
      </div>
      {!t.busy.value && view !== 'main' && (
        <div class="cl-window cl-title-panel" role="dialog">
          <div class="cl-window-title">
            <span>{TITLES[view]}</span>
            <button class="cl-close" aria-label="Закрыть" onClick={() => (t.view.value = 'main')}>
              ×
            </button>
          </div>
          <div class="cl-window-body">
            {view === 'new' && <NewIsland game={game} metas={metas ?? []} />}
            {view === 'islands' && <SavesTab game={game} onTitle />}
            {view === 'mods' && <ModsTab game={game} />}
            {view === 'settings' && <SettingsTab game={game} />}
          </div>
        </div>
      )}
      <div class="cl-title-version">v{GAME_VERSION}</div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ComponentChildren }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      <span style={{ fontWeight: 800, fontSize: '14px' }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: '12px', color: 'var(--ui-text-soft)' }}>{hint}</span>}
    </label>
  )
}

/** Names, seed and the slot of a new island; overwriting a slot asks twice. */
function NewIsland({ game, metas }: { game: Game; metas: SaveMeta[] }) {
  const slots = game.sessions.slotIds()
  const taken = (slot: string) => metas.find((m) => m.slot === slot)
  const [island, setIsland] = useState('')
  const [player, setPlayer] = useState('')
  const [seed, setSeed] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [sure, setSure] = useState(false)
  const slot = picked ?? slots.find((s) => !taken(s)) ?? null
  const old = slot ? taken(slot) : undefined
  const create = () => {
    if (!slot) return
    if (old && !sure) return setSure(true)
    void game.title.create({ slot, name: cleanName(island), player: cleanName(player), seed: parseSeed(seed) })
  }
  const value = (e: Event) => (e.target as HTMLInputElement).value
  return (
    <form
      style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: 'min(380px, 84vw)' }}
      onSubmit={(e) => {
        e.preventDefault()
        create()
      }}
    >
      <Field label="Как назовём остров?">
        <input class="cl-input" maxLength={MAX_NAME} value={island} placeholder={DEFAULT_ISLAND} onInput={(e) => setIsland(value(e))} />
      </Field>
      <Field label="Как вас зовут?" hint="Так вас будут звать соседи.">
        <input class="cl-input" maxLength={MAX_NAME} value={player} placeholder="Ваше имя" onInput={(e) => setPlayer(value(e))} />
      </Field>
      <Field label="Сид" hint="Необязательно: одинаковый сид — одинаковый остров.">
        <input class="cl-input" maxLength={40} value={seed} placeholder="случайный" onInput={(e) => setSeed(value(e))} />
      </Field>
      <div>
        <div style={{ fontWeight: 800, fontSize: '14px', marginBottom: '5px' }}>Место для сохранения</div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {slots.map((s, i) => {
            const m = taken(s)
            return (
              <button
                key={s}
                type="button"
                class={`cl-btn${s === slot ? '' : ' secondary'}`}
                onClick={() => {
                  setPicked(s)
                  setSure(false)
                }}
              >
                {i + 1} · {m ? m.name : 'пусто'}
              </button>
            )
          })}
        </div>
      </div>
      {(old || !slot) && (
        <div style={{ fontSize: '13px', color: '#c96f4a', fontWeight: 700 }}>
          {!slot
            ? 'Все места заняты. Выберите, какой остров заменить.'
            : sure
              ? `Остров «${old!.name}» исчезнет навсегда. Точно начать новый на его месте?`
              : `Здесь уже живёт остров «${old!.name}» — новый займёт его место.`}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
        {sure && (
          <Button secondary onClick={() => setSure(false)}>
            Нет
          </Button>
        )}
        <button type="submit" class="cl-btn" disabled={!slot}>
          {sure ? 'Да, заменить' : 'В путь!'}
        </button>
      </div>
    </form>
  )
}
