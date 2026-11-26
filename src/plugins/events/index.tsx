/**
 * Calendar events: fairs and festivals on dates or weekdays (content/events/events.calendar.json5).
 * While one is on, a guest (content/events/events.guests.json5) stands on the plaza with a small
 * shop of their own, and decor goes up around them. When it's over, they pack up.
 */
import { definePlugin, signal, ui, useState, voiceBlip, z, type Entity, type PluginApi, type RegistryEntry, type RegistryView, type Signal } from '@sdk'
import { isOn, type When } from './calendar'

export interface EventDef extends RegistryEntry, When {
  name: string
  note: string
  guest?: string
  hours: [number, number]
  decor: Array<{ piece: string; variant: string; dx: number; dz: number }>
  shop: Array<{ item: string; price: number }>
}

export interface GuestDef extends RegistryEntry {
  name: string
  she: boolean
  animal: string
  head: string
  phrase: string
  voice: number
  speed: number
  colors: Record<string, string>
  lines: Record<string, string[]>
}

declare module '@sdk' {
  interface Components {
    guest?: { id: string; event: string }
    eventDecor?: { event: string }
  }
  interface Registries {
    'events:calendar': EventDef
    'events:guests': GuestDef
  }
  interface GameEvents {
    'events:started': { id: string }
  }
}

const Config = z.object({
  /** Force an event (id) for testing; '' = follow the calendar. */
  force: z.string().default(''),
  /** Where the guest stands: this far south of the island middle (cells). */
  plazaOffset: z.number().int().min(0).max(30).default(8).meta({ label: 'plaza offset', step: 1 }),
})

export default definePlugin({
  id: 'events',
  version: '0.1.0',
  description: 'Праздники по календарю: гости на площади, особые лавки, украшения',
  dependsOn: ['items', 'decor', 'characters'],
  optionalDependsOn: ['economy', 'quests', 'villagers', 'daily', 'cutscene'],

  setup(api) {
    const cfg = api.config.define(Config)
    const calendar = api.createRegistry<EventDef>(
      'events:calendar',
      z.looseObject({
        id: z.string(),
        name: z.string(),
        note: z.string().default(''),
        from: z.tuple([z.number(), z.number()]).optional(),
        to: z.tuple([z.number(), z.number()]).optional(),
        weekdays: z.array(z.number()).optional(),
        guest: z.string().optional(),
        hours: z.tuple([z.number(), z.number()]).default([8, 20]),
        decor: z.array(z.object({ piece: z.string(), variant: z.string(), dx: z.number(), dz: z.number() })).default([]),
        shop: z.array(z.object({ item: z.string(), price: z.number().int().min(0) })).default([]),
      }) as never,
    )
    const guests = api.createRegistry<GuestDef>(
      'events:guests',
      z.looseObject({
        id: z.string(),
        name: z.string(),
        she: z.boolean().default(false),
        animal: z.string(),
        head: z.string(),
        phrase: z.string().default(''),
        voice: z.number().default(320),
        speed: z.number().default(0.028),
        colors: z.record(z.string(), z.string()).default({}),
        lines: z.record(z.string(), z.array(z.string())).default({}),
      }) as never,
    )
    api.components.define('guest', z.object({ id: z.string(), event: z.string() }))
    api.components.define('eventDecor', z.object({ event: z.string() }))

    /** Today's event, if any. */
    const today = (): EventDef | undefined => {
      if (cfg.force) return calendar.get(cfg.force) ?? undefined
      const d = api.time.now()
      return calendar.all().find((e) => isOn(e, { month: d.month + 1, day: d.day, weekday: d.weekday }))
    }
    const present = () => [...api.entities.world.with('guest', 'transform')]
    const decorUp = () => [...api.entities.world.with('eventDecor', 'transform')]
    const packUp = () => {
      for (const e of [...present(), ...decorUp()]) api.entities.despawn(e)
    }
    // Event decor belongs to the event: it can't be taken home.
    api.hooks.tap('decor:canTake', (ok, { entity }) => ok && !entity.eventDecor)

    const setUp = (ev: EventDef) => {
      const g = ev.guest ? guests.get(ev.guest) : undefined
      if (!g || !api.services.has('decor:pieces')) return
      const decor = api.services.get('decor:pieces')
      const cx = Math.floor(api.world.sizeX / 2)
      const cz = Math.floor(api.world.sizeZ / 2) + cfg.plazaOffset
      for (let r = 0; r < 25; r++)
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
            const x = cx + dx
            const z = cz + dz
            const y = decor.freeCell(x, z)
            // room for the guest, the decor around and a free cell in front to talk from
            if (y === null || decor.freeCell(x, z + 1) === null || !ev.decor.every((d) => decor.freeCell(x + d.dx, z + d.dz) !== null)) continue
            api.entities.spawn({
              name: g.name,
              transform: { x: x + 0.5, y, z: z + 0.5, rotY: 0 },
              model: { shape: 'rig', ref: 'core:chibi', palette: g.colors, parts: { head: g.head }, size: [1, 1, 1], color: '#fff', anchor: 'bottom' },
              biped: { speed: 0 },
              blobShadow: { radius: 0.34, opacity: 0.3 },
              blocker: { w: 1, d: 1, h: 2 },
              guest: { id: g.id, event: ev.id },
            })
            for (const d of ev.decor) {
              const e = decor.place(d.piece, d.variant, x + d.dx, z + d.dz, 0)
              if (e) api.entities.world.addComponent(e, 'eventDecor', { event: ev.id })
            }
            api.events.emit('events:started', { id: ev.id })
            return
          }
    }
    // Keep the plaza in step with the calendar and the clock (checked every few seconds).
    let checkIn = 0
    const sync = () => {
      const ev = today()
      const h = api.time.hour
      const open = !!ev && (ev.hours[0] <= ev.hours[1] ? h >= ev.hours[0] && h < ev.hours[1] : h >= ev.hours[0] || h < ev.hours[1])
      const here = present()[0]
      if (!open || !ev) {
        if (here || decorUp().length) packUp()
        return
      }
      if (here && here.guest!.event === ev.id) return
      packUp()
      setUp(ev)
    }
    api.events.on('session:started', () => {
      packUp() // set up fresh from the calendar
      checkIn = 0
    })
    api.config.onChange(() => (checkIn = 0))
    api.systems.add({
      id: 'calendar',
      phase: 'update',
      run: ({ dt }) => {
        if ((checkIn -= dt) > 0) return
        checkIn = 3
        sync()
      },
    })
    // the guest looks at whoever comes close
    const players = api.entities.world.with('player', 'transform')
    const guestQuery = api.entities.world.with('guest', 'transform')
    api.systems.add({
      id: 'guest',
      phase: 'render',
      run: () => {
        let pl: (typeof players.entities)[number] | undefined
        for (const e of players) {
          pl = e
          break
        }
        if (!pl) return
        for (const g of guestQuery) {
          if (Math.hypot(pl.transform.x - g.transform.x, pl.transform.z - g.transform.z) < 5) g.transform.rotY = Math.atan2(pl.transform.x - g.transform.x, pl.transform.z - g.transform.z)
        }
      },
    })

    const talking = signal<Entity | null>(null)
    api.registry('interactions').register({
      id: 'events:talk',
      entity: 'guest',
      priority: 70,
      anim: 'none',
      label: (ctx) => `Поговорить: ${guests.get(ctx.target!.guest!.id)?.name ?? ''}`,
      run: (ctx) => {
        talking.value = ctx.target!
        api.ui.open('events:guest')
      },
    })
    if (api.services.has('cutscene:talk')) api.services.get('cutscene:talk').conversation('events:guest', () => talking.value)
    api.ui.window({
      id: 'events:guest',
      title: 'Гость острова',
      backdrop: 'clear',
      align: 'bottom',
      component: () => <GuestTalk api={api} who={talking} guests={guests} calendar={calendar} />,
    })

    try {
      api.registry('daily:sections').register({
        id: 'events:today',
        order: 5,
        line: () => {
          const ev = today()
          return ev ? { icon: '🎉', text: `${ev.name}! ${ev.note}` } : null
        },
      })
    } catch {
      // no daily notes
    }

    api.commands.register({
      name: 'event',
      description: 'Праздники: event (что сегодня) · event <id> (включить) · event auto',
      usage: '[id | auto]',
      run: ([id]) => {
        if (id === 'auto') cfg.force = ''
        else if (id) {
          const full = id.includes(':') ? id : `events:${id}`
          if (!calendar.has(full)) throw new Error(`нет праздника "${id}": ${calendar.ids().join(', ')}`)
          cfg.force = full
        }
        checkIn = 0
        const ev = today()
        return ev ? `сегодня: ${ev.name}${cfg.force ? ' (включено вручную)' : ''}` : 'сегодня праздников нет'
      },
    })
  },
})

function GuestTalk({ api, who, guests, calendar }: { api: PluginApi; who: Signal<Entity | null>; guests: RegistryView<GuestDef>; calendar: RegistryView<EventDef> }) {
  const e = who.value
  const g = e?.guest ? guests.get(e.guest.id) : undefined
  const ev = e?.guest ? calendar.get(e.guest.event) : undefined
  const line = (topic: string) => {
    const l = g?.lines[topic] ?? ['…']
    return l[Math.floor(Math.random() * l.length)]!
  }
  const [text, setText] = useState(() => line('greet'))
  const [shopping, setShopping] = useState(false)
  const actor = [...api.entities.world.with('player', 'transform')][0]
  const items = api.registry('items')
  const wallet = api.services.has('economy:wallet') ? api.services.get('economy:wallet') : null
  wallet?.bells.value
  if (!g || !ev || !actor) return null
  const buy = (item: string, price: number) => {
    if (!wallet || !wallet.spend(price)) return setText(line('poor'))
    if (api.services.get('items:inventory').add(actor, item, 1, { quiet: true, fresh: true }) > 0) {
      wallet.add(price)
      return setText('Карманы полны!')
    }
    api.audio.play('economy:coins')
    setText(line('thanks'))
  }
  const scene = api.services.has('cutscene:talk') ? api.services.get('cutscene:talk') : undefined
  return (
    <div style={{ width: 'min(600px, 90vw)' }}>
      <ui.Dialogue speaker={`${g.name}, ${g.animal} · ${ev.name}`} text={text} typeSpeed={g.speed} onBlip={() => voiceBlip(api, g.voice)} onTyping={(on) => scene?.typing(on)} onLine={(t) => scene?.line(t)}>
        {shopping && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {ev.shop.map((s) => (
              <div key={s.item} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '76px', gap: '2px' }}>
                <ui.ItemSlot icon={api.ui.itemIcon(s.item)} title={items.get(s.item)?.name} onClick={() => buy(s.item, s.price)} />
                <span style={{ fontSize: '11px', textAlign: 'center', lineHeight: 1.2 }}>{items.get(s.item)?.name ?? s.item}</span>
                <span style={{ fontSize: '11px', fontWeight: 800, color: (wallet?.bells.value ?? 0) >= s.price ? 'var(--ui-text)' : '#d9774a' }}>{s.price.toLocaleString('ru-RU')} 🔔</span>
              </div>
            ))}
          </div>
        )}
        <ui.Choices
          items={[
            shopping ? ['Назад', () => setShopping(false)] : ['Купить', () => setShopping(true)],
            !shopping && ['Поболтать', () => setText(line('chat'))],
            ['Пока!', () => (setText(line('bye')), api.ui.close())],
          ]}
        />
      </ui.Dialogue>
    </div>
  )
}
