import { useState } from 'preact/hooks'
import type { Game } from '../Game'
import type { ModManifest } from '../mods/package'
import type { ModInfo } from '../mods/ModManager'
import { Button } from '../ui/components'
import { downloadFile, pickFile } from '../ui/files'

interface Pending {
  manifest: ModManifest
  files: Record<string, Uint8Array>
  replaces: ModInfo | undefined
}

/** Title page «Моды»: install from a .zip, switch on and off, export, remove. Changes apply together. */
export function ModsTab({ game }: { game: Game }) {
  const { mods } = game
  const [list, setList] = useState(() => mods.list())
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [confirm, setConfirm] = useState('')
  const [note, setNote] = useState('')
  const refresh = (changed = true) => {
    setList(mods.list())
    setDirty((d) => d || changed)
  }
  const attempt = async (fn: () => Promise<void>) => {
    setNote('')
    try {
      await fn()
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    }
  }

  const choose = async (file: File | undefined) => {
    if (file) await attempt(async () => setPending(await mods.open(new Uint8Array(await file.arrayBuffer()))))
  }
  const install = (p: Pending) =>
    attempt(async () => {
      await mods.install(p.manifest, p.files)
      setPending(null)
      refresh()
    })

  if (pending) {
    const { manifest: m, replaces } = pending
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: 'min(460px, 84vw)' }}>
        <div style={{ fontWeight: 800, fontSize: '18px' }}>
          {m.name} <small style={{ color: 'var(--ui-text-soft)' }}>{m.version}</small>
        </div>
        {m.author && <div style={{ fontSize: '13px', color: 'var(--ui-text-soft)' }}>Автор: {m.author}</div>}
        {m.description && <div style={{ fontSize: '14px' }}>{m.description}</div>}
        <div style={{ fontSize: '13px', fontWeight: 700, color: m.main ? '#c96f4a' : 'var(--ui-text-soft)' }}>
          {m.main ? 'В моде есть код: он сможет всё, что может сама игра. Ставьте моды с кодом только от тех, кому доверяете.' : 'В моде только данные, кода нет.'}
        </div>
        {replaces && (
          <div style={{ fontSize: '13px' }}>
            Заменит установленный «{replaces.name}» {replaces.version}.
          </div>
        )}
        {note && <div style={{ fontSize: '13px', color: '#c96f4a' }}>{note}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <Button secondary onClick={() => setPending(null)}>
            Отмена
          </Button>
          <Button onClick={() => void install(pending)}>Установить</Button>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: 'min(520px, 84vw)' }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        void choose(e.dataTransfer?.files[0])
      }}
    >
      {!list.length && <div style={{ fontSize: '14px' }}>Модов пока нет. Установите .zip или положите папку в mods/.</div>}
      {list.map((m) => (
        <div key={m.id} style={{ background: 'var(--ui-bg-2)', borderRadius: '16px', padding: '10px 14px', display: 'flex', gap: '12px', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={m.enabled}
            aria-label={`Включить ${m.name}`}
            style={{ width: '22px', height: '22px', flex: 'none', accentColor: 'var(--ui-accent)' }}
            onChange={(e) => {
              mods.setEnabled(m.id, (e.target as HTMLInputElement).checked)
              refresh()
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800 }}>
              {m.name} <small style={{ color: 'var(--ui-text-soft)' }}>{m.version}</small>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--ui-text-soft)' }}>
              {[m.author, m.hasCode ? 'с кодом' : 'только данные', m.source === 'folder' ? 'из папки mods/' : ''].filter(Boolean).join(' · ')}
            </div>
            {m.description && <div style={{ fontSize: '13px' }}>{m.description}</div>}
            {m.enabled &&
              m.errors.slice(0, 4).map((e) => (
                <div key={e} style={{ fontSize: '12px', color: '#c96f4a', overflowWrap: 'anywhere' }}>
                  ⚠ {e}
                </div>
              ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <Button secondary onClick={() => void attempt(async () => downloadFile(`${m.id}.zip`, await mods.exportZip(m.id), 'application/zip'))}>
              Экспорт
            </Button>
            {m.source === 'installed' && (
              <Button
                secondary
                onClick={() => {
                  if (confirm !== m.id) return setConfirm(m.id)
                  setConfirm('')
                  void attempt(async () => {
                    await mods.remove(m.id)
                    refresh()
                  })
                }}
              >
                {confirm === m.id ? 'Точно?' : 'Удалить'}
              </Button>
            )}
          </div>
        </div>
      ))}
      {note && <div style={{ fontSize: '13px', color: '#c96f4a' }}>{note}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <Button secondary onClick={() => void pickFile('.zip,application/zip').then(choose)}>
          Установить .zip
        </Button>
        {dirty || mods.safeMode ? (
          <Button onClick={() => void game.title.applyMods()}>Применить</Button>
        ) : (
          <span style={{ fontSize: '12px', color: 'var(--ui-text-soft)' }}>Файл можно перетащить сюда</span>
        )}
      </div>
    </div>
  )
}
