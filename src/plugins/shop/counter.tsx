/** Talking to Тоша at the counter: buy today's goods, or go sell / check the market. */
import { ui, useState, voiceBlip, type PluginApi, type ReadonlySignal } from '@sdk'
import type { Shop } from './index'

export function Counter(props: {
  api: PluginApi
  shop: Shop
  version: ReadonlySignal<number>
  firstMeeting: () => boolean
  setTalking: (on: boolean) => void
  typeSpeed: number
  voicePitch: number
}) {
  const { api, shop } = props
  props.version.value
  const wallet = api.services.get('economy:wallet')
  wallet.bells.value
  const items = api.registry('items')
  const say = (topic: string, vars: Record<string, string | number> = {}) => {
    const lines = api.registry('shop:dialogue').get(`shop:${topic}`)?.lines ?? ['…']
    return lines[Math.floor(Math.random() * lines.length)]!.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
  }
  const [text, setText] = useState(() => say(props.firstMeeting() ? 'greet_first' : 'greet'))
  const [mode, setMode] = useState<'talk' | 'buy'>('talk')
  const actor = [...api.entities.world.with('player', 'transform')][0]
  if (!actor) return null

  const marketNews = () => {
    const m = api.services.get('economy:market')
    const all = m.categories().map((c) => [c, m.demand(c)] as const).sort((a, b) => b[1] - a[1])
    const up = all.filter(([, d]) => d > 1.05).slice(0, 2)
    const down = all.filter(([, d]) => d < 0.95).slice(-1)
    const pct = (d: number) => `${d > 1 ? '+' : '−'}${Math.round(Math.abs(d - 1) * 100)}%`
    return [
      up.length ? `Дороже всего сейчас: ${up.map(([c, d]) => `${c.name.toLowerCase()} (${pct(d)})`).join(', ')}.` : 'Сегодня ничего особенно не подорожало.',
      down.length ? `А вот ${down[0]![0].name.toLowerCase()} подешевели (${pct(down[0]![1])}).` : '',
    ].join(' ')
  }

  const buy = (id: string, price: number) => {
    const r = shop.buy(actor, id)
    const name = items.get(id)?.name ?? id
    setText(r === 'ok' ? say('thanks', { name }) : r === 'poor' ? say('poor', { name, price, bells: wallet.bells.value }) : r === 'full' ? say('full') : say('sold_out'))
  }

  return (
    <div style={{ width: 'min(620px, 90vw)' }}>
      <ui.Dialogue speaker="Тоша, лавочница" text={text} typeSpeed={props.typeSpeed} onBlip={() => voiceBlip(api, props.voicePitch)} onTyping={props.setTalking}>
        {mode === 'buy' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '46vh', overflowY: 'auto' }}>
            {shop.today().map(({ shelf, goods }) => (
              <div key={shelf.id}>
                <div style={{ fontWeight: 800, fontSize: '12px', color: 'var(--ui-text-soft)', marginBottom: '4px' }}>{shelf.name}</div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {goods.map((g) => (
                    <div key={g.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', width: '76px', opacity: g.left > 0 ? 1 : 0.35 }}>
                      <ui.ItemSlot icon={api.ui.itemIcon(g.id)} title={items.get(g.id)?.name} onClick={() => buy(g.id, g.price)} />
                      <span style={{ fontSize: '11px', textAlign: 'center', lineHeight: 1.2 }}>{items.get(g.id)?.name}</span>
                      <span style={{ fontSize: '11px', fontWeight: 800, color: g.price <= wallet.bells.value ? 'var(--ui-text)' : '#d9774a' }}>
                        {g.price.toLocaleString('ru-RU')} 🔔{Number.isFinite(g.left) && g.left !== 1 ? ` · ${g.left}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <ui.Choices
          items={[
            mode === 'talk' ? ['Купить', () => (setMode('buy'), setText(say('browse')))] : ['Назад', () => (setMode('talk'), setText(say('greet')))],
            ['Продать', () => api.ui.open('economy:sell')],
            mode === 'talk' && ['Что на рынке?', () => setText(`${say('market')} ${marketNews()}`)],
            ['Цены дня', () => api.ui.open('economy:market')],
            ['Пока!', () => api.ui.close()],
          ]}
        />
        <div style={{ fontSize: '12px', color: 'var(--ui-text-soft)', textAlign: 'right' }}>В кошельке {wallet.bells.value.toLocaleString('ru-RU')} 🔔</div>
      </ui.Dialogue>
    </div>
  )
}
