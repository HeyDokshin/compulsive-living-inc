/**
 * Talking to the curator: her lines (registry `museum:dialogue`) type out with a soft babble, then
 * a few choices — donate, identify a fossil, how's the museum, bye.
 */
import { ui, useEffect, useRef, useState, type Entity, type PluginApi, type RegistryEntry } from '@sdk'

export interface DialogueDef extends RegistryEntry {
  lines: string[]
}

export interface CuratorDeps {
  api: PluginApi
  /** Has the player talked to her before (on this island)? */
  met: () => boolean
  meet: () => void
  donated: (id: string) => boolean
  donatedCount: () => number
  donate: (actor: Entity, id: string) => boolean
  identify: (actor: Entity) => string | null
  unknownFossil: string
  setTalking: (on: boolean) => void
  /** Seconds per character while typing, and the babble pitch. */
  typeSpeed: number
  voicePitch: number
}

/** Fill {name} style placeholders. */
export function fill(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)).replace(/\s+$/, '')
}

export function Curator({ deps }: { deps: CuratorDeps }) {
  const { api } = deps
  const inv = api.services.get('items:inventory')
  const catalog = api.services.get('collection:catalog')
  inv.version.value
  const actor = [...api.entities.world.with('player', 'transform')][0]
  const say = (topic: string, vars: Record<string, string | number> = {}) => {
    const lines = api.registry('museum:dialogue').get(`museum:${topic}`)?.lines ?? ['…']
    return fill(lines[Math.floor(Math.random() * lines.length)]!, vars)
  }
  const [text, setText] = useState(() => {
    const first = !deps.met()
    deps.meet()
    return say(first ? 'greet_first' : 'greet')
  })
  const [shown, setShown] = useState(0)
  const [mode, setMode] = useState<'talk' | 'donate'>('talk')
  const typing = shown < text.length

  // Type the text out with a little voice.
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    setShown(0)
    deps.setTalking(true)
    let i = 0
    timer.current = window.setInterval(() => {
      i++
      setShown(i)
      const ch = text[i - 1] ?? ''
      if (i % 2 === 0 && /[\p{L}]/u.test(ch)) {
        api.audio.note({ wave: 'triangle', freq: deps.voicePitch * (0.85 + Math.random() * 0.35), duration: 0.045, gain: 0.05, attack: 0.004, bus: 'ui' })
      }
      if (i >= text.length) {
        window.clearInterval(timer.current)
        deps.setTalking(false)
      }
    }, deps.typeSpeed * 1000)
    return () => {
      window.clearInterval(timer.current)
      deps.setTalking(false)
    }
  }, [text])

  if (!actor) return null
  const skip = () => {
    window.clearInterval(timer.current)
    setShown(text.length)
    deps.setTalking(false)
  }
  const pocket = inv.of(actor)?.slots ?? []
  const candidates = [...new Set(pocket.filter((s) => s && catalog.get(s.id) && !deps.donated(s.id)).map((s) => s!.id))]
  const unknown = inv.count(actor, deps.unknownFossil)
  const total = catalog.all().length

  const choices: Array<[string, () => void]> =
    mode === 'donate'
      ? [['Назад', () => (setMode('talk'), setText(say('greet')))]]
      : [
          [
            'Подарить находку',
            () => {
              if (!candidates.length) return setText(say('nothing'))
              setMode('donate')
              setText(say('pick'))
            },
          ],
          ...(unknown
            ? ([
                [
                  `Оценить окаменелость (${unknown})`,
                  () => {
                    const id = deps.identify(actor)
                    const s = id ? catalog.get(id) : undefined
                    if (!s) return
                    setText(`${say('assess', { name: s.name, description: s.description ?? '' })}${deps.donated(s.id) ? ' ' + say('assess_dup') : ''}`)
                  },
                ],
              ] as Array<[string, () => void]>)
            : []),
          [
            'Как дела у музея?',
            () => {
              const count = deps.donatedCount()
              if (count >= total) return setText(say('complete'))
              const fresh = (['fish', 'bug'] as const).some((k) => catalog.available(k).some((s) => !deps.donated(s.id)))
              setText(`${say('progress', { count, total })} ${say(fresh ? 'hint_new' : 'hint_none')}`)
            },
          ],
          ['Пока!', () => api.ui.close()],
        ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: 'min(560px, 88vw)' }}>
      <div
        onClick={skip}
        style={{
          background: '#fffaf0',
          borderRadius: '18px',
          padding: '14px 16px',
          minHeight: '84px',
          fontSize: '15px',
          lineHeight: 1.45,
          cursor: typing ? 'pointer' : 'default',
          boxShadow: 'inset 0 0 0 2px rgba(201, 150, 106, .25)',
        }}
      >
        <div style={{ fontWeight: 800, fontSize: '12px', color: 'var(--ui-accent)', marginBottom: '4px' }}>Мира, смотрительница</div>
        {text.slice(0, shown)}
        {typing && <span style={{ opacity: 0.4 }}>▍</span>}
      </div>
      {!typing && mode === 'donate' && (
        <ui.Grid columns={7}>
          {candidates.map((id) => (
            <ui.ItemSlot
              key={id}
              icon={api.ui.itemIcon(id)}
              title={catalog.get(id)?.name}
              onClick={() => {
                const s = catalog.get(id)
                if (!s || !deps.donate(actor, id)) return
                const left = candidates.length - 1
                setText(say('thanks', { name: s.name, description: s.description ?? '' }))
                if (!left) setMode('talk')
              }}
            />
          ))}
        </ui.Grid>
      )}
      {!typing && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {choices.map(([label, run], i) => (
            <ui.Button key={label} secondary={i > 0} onClick={run}>
              {label}
            </ui.Button>
          ))}
        </div>
      )}
    </div>
  )
}
