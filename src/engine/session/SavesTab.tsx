import { useEffect, useState } from 'preact/hooks'
import { Button } from '../ui/components'
import { downloadFile, pickFile } from '../ui/files'
import type { Game } from '../Game'
import type { SaveMeta } from '../save/format'

export const fmtTime = (s: number) => {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h} ч ${m} мин` : `${m} мин`
}
export const fmtDate = (t: number) => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * Menu tab «Острова»: save, slots (load / overwrite / delete / export / import), new island.
 * On the title screen (`onTitle`) nothing is being played: only load, delete, export, import.
 */
export function SavesTab({ game, onTitle = false }: { game: Game; onTitle?: boolean }) {
  const sm = game.sessions
  const [metas, setMetas] = useState<SaveMeta[]>([])
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const refresh = () => void sm.storage.list().then(setMetas)
  useEffect(refresh, [])

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true)
    setConfirm(null)
    try {
      await fn()
      setNote(label)
    } catch (e) {
      setNote(`Ошибка: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
      refresh()
    }
  }

  const exportSlot = (slot: string) =>
    run('Файл сохранения скачан', async () => downloadFile(`compulsive-living-${slot}.json`, await sm.exportSlot(slot), 'application/json'))

  const importInto = async (slot: string) => {
    const file = await pickFile('.json,application/json')
    if (file) void run('Сохранение импортировано', async () => sm.importInto(await file.text(), slot))
  }

  const s = sm.session
  const ask = (key: string, label: string, action: () => void) =>
    confirm === key ? (
      <span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
        <span style={{ fontSize: '13px' }}>Точно?</span>
        <Button onClick={action}>Да</Button>
        <Button secondary onClick={() => setConfirm(null)}>
          Нет
        </Button>
      </span>
    ) : (
      <Button secondary disabled={busy} onClick={() => setConfirm(key)}>
        {label}
      </Button>
    )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}>
      {!onTitle && <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: '16px' }}>{s.name}</div>
          <div style={{ color: 'var(--ui-text-soft)', fontSize: '13px' }}>
            {s.player ? `${s.player} · ` : ''}сид {game.worldConfig.seed} · в игре {fmtTime(s.playTime)} · слот {s.slot.replace('slot', '')}
          </div>
        </div>
        <Button disabled={busy} onClick={() => run('Сохранено', () => sm.save())}>
          Сохранить
        </Button>
      </div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {sm.slotIds().map((slot, i) => {
          const m = metas.find((x) => x.slot === slot)
          return (
            <div
              key={slot}
              style={{
                background: 'var(--ui-bg-2)',
                borderRadius: '16px',
                padding: '10px 14px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '10px',
                border: !onTitle && slot === s.slot ? '2.5px solid var(--ui-accent)' : '2.5px solid transparent',
              }}
            >
              <div>
                <div style={{ fontWeight: 800 }}>
                  Слот {i + 1}
                  {m ? ` · ${m.name}` : ''}
                </div>
                <div style={{ color: 'var(--ui-text-soft)', fontSize: '12px' }}>
                  {m && sm.missingMods(m).length > 0 && <div style={{ color: '#c96f4a' }}>нет модов: {sm.missingMods(m).join(', ')}</div>}
                  {m ? `${m.player ? `${m.player} · ` : ''}${fmtDate(m.savedAt)} · ${fmtTime(m.playTime)} · сид ${m.seed}` : 'пусто'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {m && (
                  <Button disabled={busy} onClick={() => run('Загружено', () => (onTitle ? game.title.load(slot) : sm.load(slot)))}>
                    Загрузить
                  </Button>
                )}
                {onTitle ? null : m ? ask(`save:${slot}`, 'Перезаписать', () => run('Сохранено', () => sm.save(slot))) : (
                  <Button secondary disabled={busy} onClick={() => run('Сохранено', () => sm.save(slot))}>
                    Сохранить сюда
                  </Button>
                )}
                {m && (
                  <Button secondary disabled={busy} onClick={() => exportSlot(slot)}>
                    Экспорт
                  </Button>
                )}
                {m ? ask(`del:${slot}`, 'Удалить', () => run('Удалено', () => sm.storage.remove(slot))) : (
                  <Button secondary disabled={busy} onClick={() => importInto(slot)}>
                    Импорт
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
        <span style={{ color: 'var(--ui-text-soft)', fontSize: '13px' }}>{note || (onTitle ? '' : 'Игра сохраняется сама каждые пару минут.')}</span>
        {!onTitle && (
          <Button secondary disabled={busy} onClick={() => void game.title.leaveGame('new')}>
            Новый остров
          </Button>
        )}
      </div>
    </div>
  )
}
