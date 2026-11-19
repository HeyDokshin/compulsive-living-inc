/**
 * First-minutes tutorial: a small card with one step at a time (walk, wardrobe, pockets, tool,
 * dig, pick up, menu). Steps live in the `tutorial:steps` registry — other plugins add theirs —
 * and complete on game events or a polled check, in any order. Progress is saved per island.
 */
import { definePlugin, signal, ui, type Entity, type GameEvents, type PluginApi, type RegistryEntry, type Signal } from '@sdk'

export interface TutorialStep extends RegistryEntry {
  order: number
  text: string
  /** Key caps shown on the card. */
  keys?: string[]
  /** Completes when this event fires (and `when` agrees, if given). */
  event?: keyof GameEvents
  when?(payload: never, api: PluginApi): boolean
  /** Or: completes when this returns true (checked a few times per second). */
  check?(api: PluginApi): boolean
}

declare module '@sdk' {
  interface Registries {
    'tutorial:steps': TutorialStep
  }
}

interface Progress {
  done: string[]
  skipped: boolean
  finished: boolean
}

export default definePlugin({
  id: 'tutorial',
  version: '0.1.0',
  description: 'Обучение первых минут',
  optionalDependsOn: ['items', 'tools', 'wardrobe', 'player'],

  setup(api) {
    const steps = api.createRegistry<TutorialStep>('tutorial:steps')
    const progress = signal<Progress>({ done: [], skipped: false, finished: false })
    api.save.register<Progress>({
      version: 1,
      save: () => progress.value,
      load: (d) => (progress.value = d),
    })

    let start: { x: number; z: number } | null = null
    const player = (): Entity | undefined => {
      for (const e of api.entities.world.with('player', 'transform')) return e
      return undefined
    }
    const heldIs = (tag: string) => {
      const p = player()
      const held = p ? api.interactions.held(p) : null
      return !!held && api.registry('items').isTagged(held, tag)
    }

    const defaults: TutorialStep[] = [
      {
        id: 'tutorial:walk',
        order: 10,
        text: 'Прогуляйтесь по острову — клавишами или кликом мыши по клетке.',
        keys: ['W', 'A', 'S', 'D', 'ЛКМ'],
        check: () => {
          const t = player()?.transform
          if (!t) return false
          start ??= { x: t.x, z: t.z }
          return Math.hypot(t.x - start.x, t.z - start.z) > 4
        },
      },
      {
        id: 'tutorial:wardrobe',
        order: 20,
        text: 'Выберите внешность: причёску и цвета одежды.',
        keys: ['C'],
        event: 'ui:opened',
        when: (p: GameEvents['ui:opened']) => p.id === 'wardrobe:editor',
      },
      {
        id: 'tutorial:pockets',
        order: 30,
        text: 'Загляните в карманы — там ваши инструменты.',
        keys: ['I'],
        event: 'ui:opened',
        when: (p: GameEvents['ui:opened']) => p.id === 'items:pockets',
      },
      {
        id: 'tutorial:shovel',
        order: 40,
        text: 'Возьмите в руки лопату.',
        keys: ['R'],
        check: () => heldIs('#core:shovels'),
      },
      {
        id: 'tutorial:dig',
        order: 50,
        text: 'Выкопайте ямку на траве или песке.',
        keys: ['Space'],
        event: 'interaction:performed',
        when: (p: GameEvents['interaction:performed']) => p.id === 'tools:dig',
      },
      {
        id: 'tutorial:pickup',
        order: 60,
        text: 'Найдите на пляже ракушку и подберите её.',
        keys: ['Space'],
        event: 'items:picked' as keyof GameEvents,
      },
      {
        id: 'tutorial:menu',
        order: 70,
        text: 'Меню — сохранения и настройки. Игра сохраняется сама.',
        keys: ['Esc'],
        event: 'ui:opened',
        when: (p: GameEvents['ui:opened']) => p.id === 'engine:menu',
      },
    ]
    for (const s of defaults) steps.register(s)

    const complete = (id: string) => {
      const p = progress.value
      if (p.finished || p.skipped || p.done.includes(id)) return
      const done = [...p.done, id]
      const all = steps.all()
      const finished = all.every((s) => done.includes(s.id))
      progress.value = { ...p, done, finished }
      api.audio.play('ui:pop')
      const pl = player()?.transform
      if (pl) api.fx.burst('core:sparkle', { x: pl.x, y: pl.y + 1.2, z: pl.z }, { amount: 0.6 })
      if (finished) api.ui.toast('Обучение пройдено! Хорошей жизни на острове ✿', { ms: 4000 })
    }

    // Event-driven steps: one subscription per distinct event, rebuilt when steps are added
    // (other plugins may register theirs after this one).
    let unsubscribe: Array<() => void> = []
    const subscribe = () => {
      unsubscribe.forEach((off) => off())
      const byEvent = new Map<string, TutorialStep[]>()
      for (const s of steps.all()) if (s.event) byEvent.set(s.event, [...(byEvent.get(s.event) ?? []), s])
      unsubscribe = [...byEvent].map(([event, list]) =>
        api.events.on(event as keyof GameEvents, (payload: unknown) => {
          for (const s of list) if (!s.when || s.when(payload as never, api)) complete(s.id)
        }),
      )
    }
    subscribe()
    steps.onChange(subscribe)
    // Polled steps.
    let poll = 0
    api.systems.add({
      id: 'check',
      phase: 'update',
      run: ({ dt }) => {
        if ((poll -= dt) > 0) return
        poll = 0.25
        const p = progress.value
        if (p.finished || p.skipped) return
        for (const s of steps.all()) if (s.check && !p.done.includes(s.id) && s.check(api)) complete(s.id)
      },
    })

    api.ui.slot('hud.topLeft', () => <Card api={api} progress={progress} />)
    api.commands.register({
      name: 'tutorial',
      description: 'Обучение: tutorial reset — начать заново, tutorial skip — пропустить',
      usage: '[reset | skip]',
      run: ([a]) => {
        if (a === 'reset') progress.value = { done: [], skipped: false, finished: false }
        if (a === 'skip') progress.value = { ...progress.value, skipped: true }
        const p = progress.value
        return `${p.done.length}/${steps.all().length}${p.skipped ? ' (пропущено)' : ''}${p.finished ? ' (пройдено)' : ''}`
      },
    })
  },
})

function Card({ api, progress }: { api: PluginApi; progress: Signal<Progress> }) {
  const p = progress.value
  if (p.finished || p.skipped || api.ui.modalOpen.value) return null
  const all = api.registry('tutorial:steps').all().sort((a, b) => a.order - b.order)
  const current = all.find((s) => !p.done.includes(s.id))
  if (!current) return null
  const index = all.indexOf(current) + 1
  return (
    <div
      style={{
        background: 'rgba(255,250,240,.94)',
        borderRadius: '20px',
        padding: '12px 16px',
        boxShadow: 'var(--ui-shadow)',
        maxWidth: '300px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        animation: 'cl-pop .25s cubic-bezier(.3,1.4,.5,1)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontWeight: 800, fontSize: '13px', color: 'var(--ui-text-soft)' }}>
          Обучение · {index}/{all.length}
        </span>
        <button
          onClick={() => (progress.value = { ...p, skipped: true })}
          style={{ border: 0, background: 'none', color: 'var(--ui-text-soft)', font: '700 12px var(--ui-font)', cursor: 'pointer' }}
        >
          Пропустить
        </button>
      </div>
      <div style={{ fontWeight: 700, fontSize: '15px', lineHeight: 1.35 }}>{current.text}</div>
      {current.keys?.length ? (
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {current.keys.map((k) => (
            <ui.Key key={k}>{k}</ui.Key>
          ))}
        </div>
      ) : null}
      <div style={{ height: '5px', background: 'var(--ui-bg-2)', borderRadius: '999px', overflow: 'hidden' }}>
        <div style={{ width: `${(p.done.length / all.length) * 100}%`, height: '100%', background: 'var(--ui-accent)', transition: 'width .4s' }} />
      </div>
    </div>
  )
}
