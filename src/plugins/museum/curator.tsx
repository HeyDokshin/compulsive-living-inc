/**
 * Talking to the curator: her lines (registry `museum:dialogue`) type out with a soft babble, then
 * a few choices — donate, identify a fossil, how's the museum, bye.
 */
import { ui, useState, voiceBlip, type Entity, type PluginApi, type RegistryEntry } from '@sdk'

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
  const [mode, setMode] = useState<'talk' | 'donate'>('talk')

  if (!actor) return null
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

  const scene = api.services.has('cutscene:talk') ? api.services.get('cutscene:talk') : undefined
  return (
    <div style={{ width: 'min(560px, 88vw)' }}>
      <ui.Dialogue
        speaker="Мира, смотрительница"
        text={text}
        typeSpeed={deps.typeSpeed}
        onBlip={() => voiceBlip(api, deps.voicePitch)}
        onTyping={(on) => (deps.setTalking(on), scene?.typing(on))}
        onLine={(t) => scene?.line(t)}
      >
        {mode === 'donate' && (
          <ui.Grid columns={7}>
            {candidates.map((id) => (
              <ui.ItemSlot
                key={id}
                icon={api.ui.itemIcon(id)}
                title={catalog.get(id)?.name}
                onClick={() => {
                  const s = catalog.get(id)
                  if (!s || !deps.donate(actor, id)) return
                  setText(say('thanks', { name: s.name, description: s.description ?? '' }))
                  if (candidates.length <= 1) setMode('talk')
                }}
              />
            ))}
          </ui.Grid>
        )}
        <ui.Choices items={choices} />
      </ui.Dialogue>
    </div>
  )
}
