import { useEffect, useState } from 'preact/hooks'
import { Button } from '../ui/components'
import type { Game } from '../Game'
import type { SaveMeta } from './format'

const fmtTime = (s: number) => {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h} ч ${m} мин` : `${m} мин`
}
const fmtDate = (t: number) => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Esc menu: save, slots (load / save here / delete / export), new island, import. */
export function SaveMenu({ game }: { game: Game }) {
  const [metas, setMetas] = useState<SaveMeta[]>([])
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const refresh = () => void game.storage.list().then(setMetas)
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
    run('Файл сохранения скачан', async () => {
      const text = await game.exportSave(slot)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
      a.download = `compulsive-living-${slot}.json`
      a.click()
      URL.revokeObjectURL(a.href)
    })

  const importInto = (slot: string) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (file) void run('Сохранение импортировано', async () => game.importSave(await file.text(), slot))
    }
    input.click()
  }

  const s = game.session
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: 'min(600px, 84vw)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: '16px' }}>{s.name}</div>
          <div style={{ color: 'var(--ui-text-soft)', fontSize: '13px' }}>
            сид {game.worldConfig.seed} · в игре {fmtTime(s.playTime)} · слот {s.slot.replace('slot', '')}
          </div>
        </div>
        <Button disabled={busy} onClick={() => run('Сохранено', () => game.saveGame())}>
          Сохранить
        </Button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {game.slotIds().map((slot, i) => {
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
                border: slot === s.slot ? '2.5px solid var(--ui-accent)' : '2.5px solid transparent',
              }}
            >
              <div>
                <div style={{ fontWeight: 800 }}>
                  Слот {i + 1}
                  {m ? ` · ${m.name}` : ''}
                </div>
                <div style={{ color: 'var(--ui-text-soft)', fontSize: '12px' }}>
                  {m ? `${fmtDate(m.savedAt)} · ${fmtTime(m.playTime)} · сид ${m.seed}` : 'пусто'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {m && (
                  <Button disabled={busy} onClick={() => run('Загружено', () => game.loadGame(slot))}>
                    Загрузить
                  </Button>
                )}
                {m ? ask(`save:${slot}`, 'Перезаписать', () => run('Сохранено', () => game.saveGame(slot))) : (
                  <Button secondary disabled={busy} onClick={() => run('Сохранено', () => game.saveGame(slot))}>
                    Сохранить сюда
                  </Button>
                )}
                {m && (
                  <Button secondary disabled={busy} onClick={() => exportSlot(slot)}>
                    Экспорт
                  </Button>
                )}
                {m ? ask(`del:${slot}`, 'Удалить', () => run('Удалено', () => game.storage.remove(slot))) : (
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
        <span style={{ color: 'var(--ui-text-soft)', fontSize: '13px' }}>{note || 'Игра сохраняется сама каждые пару минут.'}</span>
        {ask('new', 'Новый остров', () => {
          const free = game.slotIds().find((id) => !metas.some((m) => m.slot === id))
          if (!free) {
            setConfirm(null)
            setNote('Нет свободного слота — удалите один, чтобы начать новый остров.')
            return
          }
          void run('Новый остров готов', () => game.newGame({ slot: free }))
        })}
      </div>
    </div>
  )
}
