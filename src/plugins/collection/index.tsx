/**
 * Collections: fish, bugs and fossils. Species are data (content/collection/collection.species.json5);
 * each one becomes an item and a page in the encyclopedia (B). Other plugins catch things through the
 * `collection:catalog` service: which species live in a place right now, a weighted pick, and
 * `celebrate()` — the shared "you caught it!" moment (pockets, encyclopedia, toast, jingle, sparkles).
 */
import { definePlugin, signal, ui, useState, z, type Entity, type PluginApi, type ReadonlySignal, type RegistryEntry } from '@sdk'
import { describeHours, describeMonths, isAvailable, pickByRarity, type Conditions } from './availability'

export type Kind = 'fish' | 'bug' | 'fossil'

export interface SpeciesDef extends RegistryEntry {
  kind: Kind
  name: string
  description?: string
  price: number
  /** Voxel model id (default: the species id). */
  model: string
  place: string[]
  months: number[]
  hours?: [number, number]
  weather: 'any' | 'rain' | 'dry'
  rarity: number
  size: number
  /** Bugs: a soft light around it after dark (fireflies, moths). */
  glow?: { color: string; size: number; pulse: boolean }
  /** Winged bugs (with a rig): 'flutter' — big slow beats (butterflies), 'buzz' — small fast ones. */
  flap: 'flutter' | 'buzz'
}

export interface Catalog {
  get(id: string): SpeciesDef | undefined
  all(kind?: Kind): SpeciesDef[]
  /** Species of a kind that live in `place` under current conditions (time, season, weather). */
  available(kind: Kind, place?: string): SpeciesDef[]
  /** Weighted by rarity; undefined when nothing lives there now. */
  pick(kind: Kind, place: string | undefined, rand?: () => number): SpeciesDef | undefined
  /** Weighted pick from any list of species (by rarity). */
  weighted(list: readonly SpeciesDef[], rand?: () => number): SpeciesDef | undefined
  /** Current conditions (for tools and tests). */
  conditions(): Conditions
  /** Encyclopedia. */
  has(id: string): boolean
  record(id: string): boolean
  /** Give the catch to the actor and make a little fuss about it. Returns true if it was new. */
  celebrate(actor: Entity, id: string, at?: { x: number; y: number; z: number }): boolean
  /** Bumps whenever the encyclopedia changes. */
  readonly version: ReadonlySignal<number>
}

declare module '@sdk' {
  interface Registries {
    'collection:species': SpeciesDef
  }
  interface Services {
    'collection:catalog': Catalog
  }
  interface GameEvents {
    'collection:caught': { actor: Entity; id: string; isNew: boolean }
  }
}

const SpeciesSchema = z
  .looseObject({
    id: z.string(),
    tags: z.array(z.string()).optional(),
    kind: z.enum(['fish', 'bug', 'fossil']),
    name: z.string(),
    description: z.string().optional(),
    price: z.number().min(0).default(100),
    model: z.string().optional(),
    place: z.array(z.string()).default([]),
    months: z.array(z.number().int().min(1).max(12)).default([]),
    hours: z.tuple([z.number().min(0).max(24), z.number().min(0).max(24)]).optional(),
    weather: z.enum(['any', 'rain', 'dry']).default('any'),
    rarity: z.number().int().min(1).max(5).default(1),
    size: z.number().int().min(1).max(6).default(2),
    glow: z.object({ color: z.string(), size: z.number().min(0.1).max(4).default(1), pulse: z.boolean().default(false) }).optional(),
    flap: z.enum(['flutter', 'buzz']).default('flutter'),
  })
  .transform((s) => ({ ...s, model: s.model ?? s.id }))

const Config = z.object({
  /** Spawn weight for rarity 1…5. */
  rarityWeights: z.array(z.number().min(0)).length(5).default([10, 6, 3, 1.4, 0.5]),
  /** How many of one species a pocket slot holds. */
  stack: z.number().int().min(1).max(30).default(1).meta({ label: 'stack size', step: 1 }),
  jingle: z.boolean().default(true),
})

const KIND_TAG: Record<Kind, string> = { fish: 'collection:fish', bug: 'collection:bugs', fossil: 'collection:fossils' }
const KIND_VERB: Record<Kind, string> = { fish: 'Поймана рыба', bug: 'Поймано насекомое', fossil: 'Окаменелость' }
const KIND_TITLE: Record<Kind, string> = { fish: 'Рыбы', bug: 'Насекомые', fossil: 'Окаменелости' }
const PLACE_NAMES: Record<string, string> = {
  river: 'река',
  pond: 'пруд',
  sea: 'море',
  flowers: 'на цветах',
  trees: 'на деревьях',
  air: 'в воздухе',
  ground: 'на земле',
  rocks: 'у камней',
  water: 'на воде',
  beach: 'на пляже',
}

export default definePlugin({
  id: 'collection',
  version: '0.1.0',
  description: 'Коллекции: виды рыб, насекомых и окаменелостей, энциклопедия',
  dependsOn: ['items'],
  optionalDependsOn: ['weather', 'tutorial', 'daily'],

  setup(api) {
    const cfg = api.config.define(Config)
    const species = api.createRegistry<SpeciesDef>('collection:species', SpeciesSchema as never)
    const version = signal(0)
    const caught = new Map<string, number>() // id → day first caught

    // Items: one per species, same id.
    const registerItems = () => {
      const items = api.registry('items')
      for (const s of species.all()) {
        if (items.has(s.id)) continue
        items.register({
          id: s.id,
          name: s.name,
          description: s.description,
          stack: cfg.stack,
          model: s.model,
          price: s.price,
          tags: [KIND_TAG[s.kind], ...(s.kind === 'fossil' ? [] : ['collection:critters'])],
          held: { tilt: 0, scale: 1 },
          ground: { lie: false },
        })
      }
    }
    api.events.on('content:loaded', registerItems)
    registerItems()

    const conditions = (): Conditions => {
      const now = api.time.now()
      const w = api.services.has('weather:forecast') ? api.services.get('weather:forecast').current() : undefined
      return { month: now.month, hour: now.hour, raining: w?.precipitation === 'rain', hemisphere: api.engineConfig.time.hemisphere }
    }
    const all = (kind?: Kind) => species.all().filter((s) => !kind || s.kind === kind)
    const available = (kind: Kind, place?: string) => {
      const c = conditions()
      return all(kind).filter((s) => isAvailable(s, c, place))
    }

    const record = (id: string) => {
      if (caught.has(id)) return false
      caught.set(id, api.time.dayIndex)
      version.value++
      return true
    }

    const jingle = (isNew: boolean) => {
      if (!cfg.jingle) return
      const notes = isNew ? [72, 76, 79, 84] : [76, 79, 84]
      notes.forEach((midi, i) =>
        api.audio.note({ wave: 'triangle', freq: 440 * 2 ** ((midi - 69) / 12), duration: 0.16, gain: 0.12, attack: 0.005, at: i * 0.09, bus: 'sfx' }),
      )
    }

    const catalog: Catalog = {
      version,
      get: (id) => species.get(id) ?? undefined,
      all,
      available,
      pick: (kind, place, rand = Math.random) => pickByRarity(available(kind, place), cfg.rarityWeights, rand),
      weighted: (list, rand = Math.random) => pickByRarity(list, cfg.rarityWeights, rand),
      conditions,
      has: (id) => caught.has(id),
      record,
      celebrate(actor, id, at) {
        const s = species.get(id)
        if (!s) return false
        const inv = api.services.get('items:inventory')
        const left = inv.add(actor, id, 1, { quiet: true })
        if (left) {
          const t = actor.transform!
          inv.spawnDrop(id, left, t.x, t.y, t.z)
        }
        const isNew = record(id)
        const text = `${KIND_VERB[s.kind]}: ${s.name}!${isNew ? ' Новая запись в энциклопедии.' : ''}${left ? ' (карманы полны — лежит рядом)' : ''}`
        void api.ui.itemIcon(id).then((icon) => api.ui.toast(text, { icon, ms: 3200 }))
        jingle(isNew)
        const p = at ?? actor.transform!
        api.fx.burst('core:sparkle', { x: p.x, y: p.y + 1.2, z: p.z }, { amount: isNew ? 2 : 1 })
        api.events.emit('collection:caught', { actor, id, isNew })
        return isNew
      },
    }
    api.services.provide('collection:catalog', catalog)

    api.save.register<Record<string, number>>({
      version: 1,
      save: () => Object.fromEntries(caught),
      load: (data) => {
        caught.clear()
        for (const [id, day] of Object.entries(data)) caught.set(id, day)
        version.value++
      },
    })

    // --- encyclopedia ----------------------------------------------------------------------------
    // Not caught yet: only the outline of the icon shows.
    const style = document.createElement('style')
    style.textContent = '.cl-silhouette img { filter: brightness(0) opacity(.28); }'
    document.head.append(style)
    api.onDispose(() => style.remove())
    api.ui.window({ id: 'collection:book', title: 'Энциклопедия', component: () => <Book api={api} catalog={catalog} /> })
    const key = api.input.action('book', ['KeyB', 'Pad8'], 'Энциклопедия')
    api.input.on(key, () => api.ui.toggle('collection:book'))

    // Morning note: how many not-yet-found species can turn up today (any hour, any weather).
    try {
      api.registry('daily:sections').register({
        id: 'collection:today',
        order: 20,
        line: () => {
          const c = conditions()
          const today = (kind: Kind) =>
            all(kind).filter(
              (s) =>
                !caught.has(s.id) &&
                Array.from({ length: 24 }, (_, h) => h).some((h) => isAvailable(s, { ...c, hour: h + 0.5, raining: s.weather === 'rain' })),
            ).length
          const fish = today('fish')
          const bugs = today('bug')
          if (!fish && !bugs) return { icon: '📖', text: 'Всех, кто водится сегодня, вы уже нашли. Загляните в энциклопедию (B).' }
          const parts = [fish && `рыб — ${fish}`, bugs && `насекомых — ${bugs}`].filter(Boolean)
          return { icon: '🎣', text: `Сегодня можно встретить новых: ${parts.join(', ')}.` }
        },
      })
    } catch {
      // no daily notes
    }

    // A step for the first-minutes tutorial, if it is installed.
    try {
      api.registry('tutorial:steps').register({
        id: 'collection:tutorial_catch',
        order: 75,
        day: 2,
        text: 'Поймайте рыбу удочкой или насекомое сачком. Всё пойманное — в энциклопедии.',
        keys: ['collection:book'],
        event: 'collection:caught',
      })
    } catch {
      // no tutorial plugin
    }

    api.commands.register({
      name: 'catch',
      description: 'Получить экземпляр: catch collection:carp · catch fish (случайная рыба сейчас) · catch all (всё в энциклопедию)',
      usage: '<id | fish | bug | fossil | all>',
      run: ([what]) => {
        const actor = [...api.entities.world.with('player', 'transform')][0]
        if (!actor) throw new Error('no player')
        if (what === 'all') {
          for (const s of all()) record(s.id)
          return `записано: ${all().length}`
        }
        const id = what === 'fish' || what === 'bug' || what === 'fossil' ? catalog.pick(what, undefined)?.id : what
        if (!id || !species.has(id)) throw new Error(`нет такого вида: ${what}`)
        catalog.celebrate(actor, id)
        return id
      },
    })
    api.commands.register({
      name: 'now',
      description: 'Кто сейчас водится: now fish river · now bug flowers',
      usage: '<fish|bug> [place]',
      run: ([kind, place]) => {
        const list = available((kind as Kind) ?? 'fish', place)
        return list.map((s) => `${s.id.padEnd(30)} ${s.name} [${s.place.join(', ')}] r${s.rarity}`).join('\n') || 'никого'
      },
    })
  },
})

// --- UI ----------------------------------------------------------------------------------------

function Book({ api, catalog }: { api: PluginApi; catalog: Catalog }) {
  catalog.version.value // re-render on changes
  const [kind, setKind] = useState<Kind>('fish')
  const [selected, setSelected] = useState<string | null>(null)
  const list = catalog.all(kind)
  const got = list.filter((s) => catalog.has(s.id)).length
  const sel = selected ? catalog.get(selected) : undefined
  const c = catalog.conditions()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: 'min(560px, 86vw)' }}>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {(['fish', 'bug', 'fossil'] as const).map((k) => (
          <ui.Button key={k} secondary={k !== kind} onClick={() => (setKind(k), setSelected(null))}>
            {KIND_TITLE[k]} {catalog.all(k).filter((s) => catalog.has(s.id)).length}/{catalog.all(k).length}
          </ui.Button>
        ))}
      </div>
      <ui.Grid columns={7}>
        {list.map((s) => {
          const known = catalog.has(s.id)
          return (
            <div key={s.id} class={known ? undefined : 'cl-silhouette'}>
              <ui.ItemSlot
                icon={api.ui.itemIcon(s.id)}
                title={known ? s.name : '???'}
                selected={selected === s.id}
                onClick={() => setSelected(selected === s.id ? null : s.id)}
              />
            </div>
          )
        })}
      </ui.Grid>
      <div style={{ minHeight: '78px', fontSize: '13px', color: 'var(--ui-text-soft)' }}>
        {sel && catalog.has(sel.id) ? (
          <div>
            <div style={{ fontWeight: 800, fontSize: '16px', color: 'var(--ui-text)' }}>
              {sel.name}
              {sel.kind !== 'fossil' && isAvailable(sel, c) ? (
                <span style={{ color: 'var(--ui-accent)', fontSize: '12px', marginLeft: '8px' }}>● сейчас можно поймать</span>
              ) : null}
            </div>
            <div>{sel.description}</div>
            <div style={{ marginTop: '4px' }}>
              {sel.kind !== 'fossil' && (
                <>
                  {sel.place.map((p) => PLACE_NAMES[p] ?? p).join(', ')} · {describeMonths(sel.months)} · {describeHours(sel.hours)}
                  {sel.weather === 'rain' ? ' · в дождь' : ''} ·{' '}
                </>
              )}
              цена {sel.price} 🔔
              {api.services.has('museum:donations') && api.services.get('museum:donations').has(sel.id) ? ' · 🏛 в музее' : ''}
            </div>
          </div>
        ) : sel ? (
          <div>Ещё не найдено. Ищите в разное время дня и года.</div>
        ) : (
          <div>
            Найдено {got} из {list.length}. Нажмите на запись, чтобы прочитать о ней.
          </div>
        )}
      </div>
    </div>
  )
}
