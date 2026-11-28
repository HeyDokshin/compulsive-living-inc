/**
 * Mail: letters in the mailbox by the house. Neighbours (and anyone else — any plugin through the
 * `mail:box` service) write: thanks for a gift, news of a friendship, a chat, a goodbye; sometimes
 * with something tucked into the envelope. The box opens on its own window; letters are kept with
 * the island.
 */
import { definePlugin, signal, ui, useEffect, useState, z, type PluginApi, type ReadonlySignal } from '@sdk'
import { pending, withLetter, type Letter } from './box'

export type { Letter } from './box'

export interface MailBox {
  /** Put a letter in the box (it's there now; the player hears about it). */
  send(letter: { from: string; fromId?: string; text: string; gift?: { item: string; count: number } }): void
  readonly letters: ReadonlySignal<readonly Letter[]>
  /** Letters still wanting attention (unread, or a gift left inside). */
  waiting(): number
}

declare module '@sdk' {
  interface Services {
    'mail:box': MailBox
  }
  interface GameEvents {
    'mail:received': { from: string }
  }
}

const Config = z.object({
  /** Letters kept once read and emptied (pending ones stay, up to twice as many). */
  keep: z.number().int().min(5).max(200).default(40).meta({ step: 1 }),
})

interface MailState {
  letters: Letter[]
  next: number
}

export default definePlugin({
  id: 'mail',
  version: '0.1.0',
  description: 'Почта: письма в почтовом ящике, подарки в конвертах',
  dependsOn: ['items'],
  optionalDependsOn: ['daily'],

  setup(api) {
    const cfg = api.config.define(Config)
    const fresh = (): MailState => ({ letters: [], next: 1 })
    const state = signal<MailState>(fresh())
    const letters = signal<readonly Letter[]>([])
    const commit = (s: MailState) => {
      state.value = s
      letters.value = s.letters
    }
    api.save.register<MailState>({ version: 1, save: () => state.value, load: (d) => commit({ ...fresh(), ...d }) })
    api.events.on('session:started', () => void (letters.value = state.value.letters))

    const box: MailBox = {
      send(l) {
        const s = state.value
        const letter: Letter = { id: s.next, from: l.from, text: l.text, day: api.time.dayIndex, read: false, taken: false }
        if (l.fromId) letter.fromId = l.fromId
        if (l.gift) letter.gift = { ...l.gift }
        commit({ letters: withLetter(s.letters, letter, cfg.keep), next: s.next + 1 })
        api.events.emit('mail:received', { from: l.from })
        api.ui.toast(`Письмо от: ${l.from}`, { icon: '✉️' })
      },
      letters,
      waiting: () => state.value.letters.filter(pending).length,
    }
    api.services.provide('mail:box', box)
    const update = (id: number, patch: Partial<Letter>) =>
      commit({ ...state.value, letters: state.value.letters.map((l) => (l.id === id ? { ...l, ...patch } : l)) })

    api.ui.window({
      id: 'mail:letters',
      title: 'Письма',
      pattern: 'hearts',
      component: () => <Letters api={api} letters={letters} update={update} />,
    })

    try {
      api.registry('daily:sections').register({
        id: 'mail:today',
        order: 38,
        line: () => {
          const n = box.waiting()
          return n ? { icon: '✉️', text: n === 1 ? 'В почтовом ящике письмо.' : `В почтовом ящике писем: ${n}.` } : null
        },
      })
    } catch {
      // no morning note
    }

    api.commands.register({
      name: 'mail',
      description: 'Почта: mail (список) · mail test (письмо себе) · mail open',
      usage: '[test | open]',
      run: ([what]) => {
        if (what === 'test') box.send({ from: 'Почтальон', text: 'Проверка связи! Почта работает.', gift: { item: 'core:apple', count: 2 } })
        if (what === 'open') api.ui.open('mail:letters')
        return (
          state.value.letters.map((l) => `${l.read ? ' ' : '•'} ${l.from}: ${l.text.slice(0, 50)}${l.gift && !l.taken ? ' 🎁' : ''}`).join('\n') || 'писем нет'
        )
      },
    })
  },
})

function Letters(props: { api: PluginApi; letters: ReadonlySignal<readonly Letter[]>; update: (id: number, patch: Partial<Letter>) => void }) {
  const { api } = props
  const all = props.letters.value
  const [openId, setOpen] = useState<number | null>(() => all.find((l) => !l.read)?.id ?? all[0]?.id ?? null)
  const items = api.registry('items')
  const actor = [...api.entities.world.with('player', 'transform')][0]
  const open = all.find((l) => l.id === openId)
  // opened is read
  useEffect(() => {
    if (open && !open.read) props.update(open.id, { read: true })
  }, [open?.id])
  if (!all.length) return <div style={{ width: 'min(420px, 86vw)', color: 'var(--ui-text-soft)' }}>Писем пока нет. Соседи пишут тем, с кем дружат.</div>

  const take = (l: Letter) => {
    if (!l.gift || l.taken || !actor) return
    const inv = api.services.get('items:inventory')
    const left = inv.add(actor, l.gift.item, l.gift.count, { fresh: true })
    if (left >= l.gift.count) return api.ui.toast('Карманы полны.')
    props.update(l.id, left ? { gift: { ...l.gift, count: left } } : { taken: true })
    api.audio.play('ui:pop')
  }
  return (
    <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', width: 'min(640px, 90vw)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: '1 1 180px', maxHeight: '52vh', overflowY: 'auto' }}>
        {all.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => setOpen(l.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 10px',
              border: 'none',
              borderRadius: '12px',
              cursor: 'pointer',
              textAlign: 'left',
              font: 'inherit',
              color: 'inherit',
              background: l.id === openId ? 'var(--ui-bg-2)' : 'transparent',
              fontWeight: l.read ? 500 : 800,
            }}
          >
            <span style={{ fontSize: '18px' }}>{l.read ? '📭' : '✉️'}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.from}</span>
            {l.gift && !l.taken && <span>🎁</span>}
          </button>
        ))}
      </div>
      {open && (
        <div
          style={{
            flex: '2 1 280px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            padding: '18px 20px',
            borderRadius: '14px',
            background: 'repeating-linear-gradient(transparent 0 27px, rgba(176, 124, 72, .14) 27px 28px), #fffdf6',
            // the ruling under each line of the text
            backgroundPosition: '0 18px',
            boxShadow: 'inset 0 0 0 2px var(--ui-line)',
            lineHeight: '28px',
          }}
        >
          <div style={{ whiteSpace: 'pre-wrap' }}>{open.text}</div>
          <div style={{ alignSelf: 'flex-end', fontStyle: 'italic', fontWeight: 700 }}>— {open.from}</div>
          {open.gift && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', lineHeight: 'normal' }}>
              <ui.ItemSlot icon={api.ui.itemIcon(open.gift.item)} title={items.get(open.gift.item)?.name} count={open.gift.count} />
              {open.taken ? (
                <span style={{ color: 'var(--ui-text-soft)' }}>В конверте было: {items.get(open.gift.item)?.name ?? open.gift.item}</span>
              ) : (
                <ui.Button onClick={() => take(open)}>Забрать: {items.get(open.gift.item)?.name ?? open.gift.item}</ui.Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
