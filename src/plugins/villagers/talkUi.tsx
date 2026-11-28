/** A conversation with a villager: chat, gifts, requests, and the talk about moving away. */
import { ui, useState, voiceBlip, type Entity, type PluginApi, type RegistryEntry, type RegistryView, type Signal } from '@sdk'
import type { PersonalityDef, VillagerDef, VillagersConfig, VillagerState } from './index'
import { fill, giftTaste, hearts, MAX_POINTS, pickLine, type LineDef } from './talk'

interface Props {
  api: PluginApi
  cfg: VillagersConfig
  who: Signal<Entity | null>
  state: Signal<VillagerState>
  touch: () => void
  defs: RegistryView<VillagerDef>
  personalities: RegistryView<PersonalityDef>
  lines: RegistryView<LineDef & RegistryEntry>
  photoId: (v: VillagerDef) => string
}

export function Talk(props: Props) {
  const { api, cfg } = props
  const npc = props.who.value
  props.state.value // re-render on changes
  const v = npc?.villager ? props.defs.get(npc.villager.id) : undefined
  const r = v ? props.state.value.residents[v.id] : undefined
  const actor = [...api.entities.world.with('player', 'transform')][0]
  const inv = api.services.get('items:inventory')
  inv.version.value
  const items = api.registry('items')
  const pers = v ? props.personalities.get(v.personality) : undefined
  const today = api.time.dayIndex

  const say = (topic: string, extra: Record<string, string | number> = {}) => {
    if (!v || !r) return '…'
    const w = api.services.has('weather:forecast') ? api.services.get('weather:forecast').current() : undefined
    const others = Object.keys(props.state.value.residents).filter((id) => id !== v.id)
    const other = props.defs.get(others[Math.floor(Math.random() * others.length)] ?? '')?.name ?? 'кто-то'
    const line = pickLine(
      props.lines.all(),
      topic,
      { personality: v.personality, hour: api.time.hour, raining: w?.precipitation === 'rain', hearts: hearts(r.points), season: api.time.season },
      Math.random,
    )
    return fill(line ?? '…', {
      name: v.name,
      phrase: v.phrase,
      animal: v.animal,
      player: api.session.player || cfg.playerName,
      other,
      a: v.she ? 'а' : '',
      hearts: hearts(r.points),
      ...extra,
    })
  }
  const add = (n: number) => {
    if (!r) return
    r.points = Math.max(0, Math.min(MAX_POINTS, r.points + n))
    props.touch()
  }

  const [text, setText] = useState(() => {
    if (!r) return '…'
    let first = say(r.met ? 'greet' : 'hello')
    r.met = true
    if (r.talkDay !== today) {
      r.talkDay = today
      r.points = Math.min(MAX_POINTS, r.points + cfg.talkPoints)
    }
    if (r.leaving >= 0) first = `${first} ${say('leaving')}`
    props.touch()
    return first
  })
  const [mode, setMode] = useState<'talk' | 'gift'>('talk')
  if (!npc || !v || !r || !actor) return null
  const h = hearts(r.points)

  const reward = () => {
    const [lo, hi] = cfg.requestBells
    const bells = Math.round((lo + Math.random() * (hi - lo)) / 10) * 10
    if (api.services.has('economy:wallet')) api.services.get('economy:wallet').add(bells)
    return bells
  }
  const give = (id: string) => {
    const name = items.get(id)?.name ?? id
    const req = r.request
    const asked = !!req && items.isTagged(id, req.tag) // what they asked for is not a gift
    if (!asked && r.giftDay === today && r.gifts >= cfg.giftsPerDay) return setText(say('gift_full'))
    if (inv.remove(actor, id, 1) < 1) return
    if (asked) {
      r.request = null
      r.helped = id // a thank-you letter tomorrow
      add(cfg.requestPoints)
      api.events.emit('villagers:helped', { id: v.id, item: id })
      const bells = reward()
      setText(`${say('request_thanks', { item: name })} (+${bells.toLocaleString('ru-RU')} 🔔)`)
      setMode('talk')
      return
    }
    r.gifts = (r.giftDay === today ? r.gifts : 0) + 1
    r.giftDay = today
    const taste = giftTaste(
      id,
      (t) => items.isTagged(id, t),
      { likes: pers?.likes ?? [], dislikes: pers?.dislikes ?? [], favourite: v.favourite?.of, hated: v.hated?.of },
      items.get(id)?.price ?? 0,
    )
    add(cfg.giftPoints[taste])
    if (taste === 'favourite' || taste === 'love') r.thanks = id // they'll write about it
    api.events.emit('villagers:gifted', { id: v.id, item: id, taste })
    if (api.services.has('emotes:show'))
      api.services
        .get('emotes:show')
        .show(npc, taste === 'love' || taste === 'favourite' ? 'emotes:love' : taste === 'dislike' || taste === 'hated' ? 'emotes:question' : 'emotes:gift')
    let reply = say(`gift_${taste}`, { item: name })
    // a best friend's photo, once
    if (hearts(r.points) >= 5 && !r.photo && api.services.has('decor:pieces')) {
      const photo = api.services.get('decor:pieces').itemId(props.photoId(v), 'default')
      if (inv.add(actor, photo, 1, { quiet: true }) === 0) {
        r.photo = true
        reply = `${reply} ${say('photo')}`
      }
    } else if ((taste === 'love' || taste === 'favourite') && h >= 2 && Math.random() < 0.35 && api.services.has('decor:pieces')) {
      // something back: a piece of furniture
      const pieces = api.services
        .get('decor:pieces')
        .all()
        .filter((p) => p.price > 0)
      const p = pieces[Math.floor(Math.random() * pieces.length)]
      const variant = p?.variants[Math.floor(Math.random() * p.variants.length)]
      if (p && variant) {
        const back = api.services.get('decor:pieces').itemId(p.id, variant.id)
        if (inv.add(actor, back, 1, { quiet: true, fresh: true }) === 0) reply = `${reply} ${say('gift_back', { item: items.get(back)?.name ?? back })}`
      }
    }
    props.touch()
    setText(reply)
    setMode('talk')
  }
  // a chat; now and then they let slip what they adore or can't stand (once they know you a little)
  const chat = () => {
    const fancy = Math.random() < 0.5 ? v.favourite : v.hated
    if (fancy && h >= 1 && Math.random() < cfg.hintChance) return setText(say(fancy === v.favourite ? 'hint_favourite' : 'hint_hated', { fancy: fancy.label }))
    setText(say('chat'))
  }
  const ask = () => {
    if (r.request) return setText(say('request_waiting', { request: r.request.label }))
    if (r.requestDay === today || Math.random() > cfg.requestChance) {
      r.requestDay = today
      props.touch()
      return setText(say('request_none'))
    }
    const req = cfg.requests[Math.floor(Math.random() * cfg.requests.length)]!
    r.request = req
    r.requestDay = today
    props.touch()
    setText(say('request_ask', { request: req.label }))
  }

  const gifts = [
    ...new Set((inv.of(actor)?.slots ?? []).filter((s) => s && (items.get(s.id)?.price ?? 0) > 0 && !items.isTagged(s.id, '#core:tools')).map((s) => s!.id)),
  ]
  const leaving = r.leaving >= 0
  const scene = api.services.has('cutscene:talk') ? api.services.get('cutscene:talk') : undefined
  return (
    <div style={{ width: 'min(580px, 90vw)' }}>
      <ui.Dialogue
        speaker={`${v.name} · ${'♥'.repeat(h)}${'♡'.repeat(5 - h)} · ${cfg.levels[h]}`}
        text={text}
        typeSpeed={pers?.speed ?? 0.028}
        onBlip={() => voiceBlip(api, pers?.voice ?? 320)}
        onTyping={(on) => scene?.typing(on)}
        onLine={(t) => scene?.line(t)}
      >
        {mode === 'gift' && (
          <ui.Grid columns={8}>
            {gifts.map((id) => (
              <ui.ItemSlot key={id} icon={api.ui.itemIcon(id)} title={items.get(id)?.name} count={inv.count(actor, id)} onClick={() => give(id)} />
            ))}
          </ui.Grid>
        )}
        <ui.Choices
          items={
            leaving
              ? [
                  [
                    'Оставайся!',
                    () => {
                      r.leaving = -1
                      add(10)
                      setText(say('stay'))
                    },
                  ],
                  [
                    'Удачи на новом месте',
                    () => {
                      r.leaving = today + 1
                      props.touch()
                      setText(say('farewell'))
                    },
                  ],
                ]
              : [
                  mode === 'gift' ? ['Назад', () => setMode('talk')] : ['Поболтать', chat],
                  mode === 'talk' && gifts.length > 0 && ['Подарить', () => setMode('gift')],
                  mode === 'talk' && [r.request ? `Принёс ${r.request.label}?` : 'Помочь чем-нибудь?', ask],
                  ['Пока!', () => api.ui.close()],
                ]
          }
        />
      </ui.Dialogue>
    </div>
  )
}
