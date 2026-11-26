/**
 * Bells (the island's money), the market and the sell box. The wallet is a service other plugins pay
 * into or take from (`economy:wallet`). The market (`economy:market`, categories in
 * content/economy/economy.market.json5) sets today's price for each kind of goods; the box near the
 * middle of the island buys anything with a price except tools, at today's market price.
 */
import { definePlugin, signal, ui, useEffect, useRef, useState, z, type Entity, type PluginApi, type ReadonlySignal, type RegistryEntry } from '@sdk'
import { categoryOf, demand, formatDemand } from './market'

export interface Wallet {
  readonly bells: ReadonlySignal<number>
  /** The last earning or spending (not loads): the HUD floats it over the wallet. */
  readonly change: ReadonlySignal<{ amount: number; key: number } | null>
  add(amount: number): void
  /** False (and nothing taken) when there isn't enough. */
  spend(amount: number): boolean
}

export interface MarketCategoryDef extends RegistryEntry {
  name: string
  icon: string
  tag: string
  amplitude: number
}

export interface Market {
  categories(): MarketCategoryDef[]
  /** Today's multiplier of a category (or of a day `daysAgo` back). */
  demand(cat: MarketCategoryDef, daysAgo?: number): number
  /** Category of an item, if any. */
  categoryOf(itemId: string): MarketCategoryDef | undefined
  /** What the box pays for one item today. */
  sellPrice(itemId: string): number
}

declare module '@sdk' {
  interface Components {
    sellBox?: Record<string, never>
  }
  interface Registries {
    'economy:market': MarketCategoryDef
  }
  interface Services {
    'economy:wallet': Wallet
    'economy:market': Market
  }
  interface GameEvents {
    'economy:sold': { actor: Entity; id: string; count: number; bells: number }
  }
}

const Config = z.object({
  startBells: z.number().int().min(0).max(1_000_000).default(0).meta({ label: 'bells on a new island', step: 100 }),
  /** Share of the item price the box pays (before the market). */
  sellRate: z.number().min(0).max(2).default(1).meta({ label: 'sell rate', step: 0.05 }),
  /** Seconds the HUD takes to count up to a new sum. */
  countUp: z.number().min(0).max(3).default(0.7).meta({ label: 'count up (s)', step: 0.05 }),
  /** Days in one market wave. */
  marketPeriod: z.number().min(2).max(60).default(7).meta({ label: 'market period (days)', step: 1 }),
  /** Items with these tags are never offered to the box. */
  keepTags: z.array(z.string()).default(['#core:tools']),
  /** Keep species the museum doesn't have yet out of "sell all". */
  keepUndonated: z.boolean().default(true).meta({ label: 'keep undonated' }),
  /** The box stands at least this far from big buildings (cells). */
  clearance: z.number().int().min(1).max(10).default(4).meta({ step: 1 }),
})
type Config = z.infer<typeof Config>

export const formatBells = (n: number) => n.toLocaleString('ru-RU')

export default definePlugin({
  id: 'economy',
  version: '0.1.0',
  description: 'Колокольчики: кошелёк и ящик для продажи',
  dependsOn: ['items'],
  // placed after the museum so the box doesn't end up on its plot
  optionalDependsOn: ['museum', 'collection', 'nature', 'garden', 'daily', 'tutorial'],

  setup(api) {
    const cfg = api.config.define(Config)
    api.components.define('sellBox', z.object({}))
    const bells = signal(0)
    const change = signal<{ amount: number; key: number } | null>(null)
    let key = 0
    const wallet: Wallet = {
      bells,
      change,
      add: (n) => {
        const before = bells.value
        bells.value = Math.max(0, bells.value + Math.round(n))
        if (bells.value !== before) change.value = { amount: bells.value - before, key: ++key }
      },
      spend: (n) => {
        if (n > bells.value) return false
        bells.value -= Math.round(n)
        if (n) change.value = { amount: -Math.round(n), key: ++key }
        return true
      },
    }
    api.services.provide('economy:wallet', wallet)
    api.save.register<{ bells: number }>({ version: 1, save: () => ({ bells: bells.value }), load: (d) => void (bells.value = d.bells) })

    // --- market ------------------------------------------------------------------------------
    const cats = api.createRegistry<MarketCategoryDef>(
      'economy:market',
      z.looseObject({ id: z.string(), name: z.string(), icon: z.string().default('•'), tag: z.string(), amplitude: z.number().min(0).max(0.95).default(0.3) }) as never,
    )
    const items = api.registry('items')
    const market: Market = {
      categories: () => cats.all(),
      demand: (cat, daysAgo = 0) => demand(api.world.seed, api.time.dayIndex - daysAgo, cat, cfg.marketPeriod),
      categoryOf: (id) => categoryOf(cats.all(), (c) => items.isTagged(id, c.tag)),
      sellPrice: (id) => {
        const cat = market.categoryOf(id)
        return Math.round((items.get(id)?.price ?? 0) * cfg.sellRate * (cat ? market.demand(cat) : 1))
      },
    }
    api.services.provide('economy:market', market)
    api.ui.window({ id: 'economy:market', title: 'Цены дня', component: () => <MarketBoard market={market} period={cfg.marketPeriod} /> })

    api.ui.slot('hud.topRight', () => <WalletPill bells={bells} change={change} countUp={cfg.countUp} />, { order: 20 })
    try {
      api.registry('daily:sections').register({ id: 'economy:wallet', order: 50, line: () => ({ icon: '🔔', text: `В кошельке ${formatBells(bells.value)} колокольчиков.` }) })
      api.registry('daily:sections').register({
        id: 'economy:market',
        order: 45,
        line: () => {
          const hot = cats
            .all()
            .map((c) => [c, market.demand(c)] as const)
            .filter(([, m]) => m > 1.05)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
          if (!hot.length) return { icon: '📉', text: 'Сегодня на рынке всё дёшево — может, лучше подождать.' }
          return { icon: '📈', text: `Сегодня в цене: ${hot.map(([c, m]) => `${c.name.toLowerCase()} ${formatDemand(m)}`).join(', ')}.` }
        },
      })
    } catch {
      // no daily notes
    }

    // --- the sell box -------------------------------------------------------------------------
    const boxes = () => [...api.entities.world.with('sellBox', 'transform')]
    const free = (x: number, z: number, y: number) => {
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const cy = api.world.surfaceY(x + dx, z + dz)
          if (cy !== y || api.world.getBlock(x + dx, cy - 1, z + dz) !== 'core:grass' || api.world.blockerAt(x + dx, z + dz)) return false
        }
      // not right next to a big building (its door and steps)
      const r = cfg.clearance
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if ((api.world.blockerAt(x + dx, z + dz)?.blocker?.w ?? 1) > 1) return false
      for (const e of api.entities.world.with('transform')) if (Math.floor(e.transform.x) === x && Math.floor(e.transform.z) === z) return false
      return true
    }
    const placeBox = (): Entity | null => {
      const cx = Math.floor(api.world.sizeX / 2)
      const cz = Math.floor(api.world.sizeZ / 2)
      for (let r = 2; r < api.world.sizeX / 2; r++)
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
            const x = cx + dx
            const z = cz + dz
            const y = api.world.surfaceY(x, z)
            if (y === api.world.ground && free(x, z, y)) {
              return api.entities.spawn({
                name: 'Ящик для продажи',
                transform: { x: x + 0.5, y, z: z + 0.5, rotY: 0 },
                model: { shape: 'voxel', ref: 'economy:sell_box', size: [1, 1, 1], color: '#d9a56c', anchor: 'bottom' },
                blocker: { w: 1, d: 1, h: 2 },
                blobShadow: { radius: 0.5, opacity: 0.25 },
                sellBox: {},
              })
            }
          }
      return null
    }
    api.events.on('session:started', () => {
      if (!api.save.hasData) bells.value = cfg.startBells
      if (!boxes().length && !placeBox()) api.log.warn('no place for the sell box')
    })

    api.registry('interactions').register({
      id: 'economy:sell',
      entity: 'sellBox',
      priority: 50,
      label: 'Продать',
      anim: 'none',
      sound: 'ui:open',
      run: () => void api.ui.open('economy:sell'),
    })
    api.ui.window({ id: 'economy:sell', title: 'Ящик для продажи', component: () => <SellBox api={api} cfg={cfg} wallet={wallet} market={market} /> })

    try {
      api.registry('tutorial:steps').register({
        id: 'economy:tutorial_sell',
        order: 90,
        day: 3,
        text: 'Продайте что-нибудь в лавке или в ящике для продажи — появятся колокольчики.',
        keys: ['player:use'],
        event: 'economy:sold',
      })
    } catch {
      // no tutorial
    }

    api.commands.register({
      name: 'market',
      description: 'Цены дня по категориям',
      run: () => cats.all().map((c) => `${c.icon} ${c.name.padEnd(16)} ${formatDemand(market.demand(c))}`).join('\n'),
    })
    api.commands.register({
      name: 'bells',
      description: 'Кошелёк: bells (сколько) · bells 5000 (добавить)',
      usage: '[amount]',
      run: ([n]) => {
        if (n) wallet.add(Number(n))
        return `${formatBells(bells.value)} колокольчиков`
      },
    })
  },
})

// --- UI ------------------------------------------------------------------------------------------

/** The wallet in the HUD: the sum counts up or down to the new value, changes float above it. */
function WalletPill({ bells, change, countUp }: { bells: ReadonlySignal<number>; change: ReadonlySignal<{ amount: number; key: number } | null>; countUp: number }) {
  const target = bells.value
  const [shown, setShown] = useState(target)
  const from = useRef(target)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    let raf = 0
    const step = () => {
      const k = countUp > 0 ? Math.min(1, (performance.now() - start) / (countUp * 1000)) : 1
      const eased = 1 - (1 - k) ** 3
      const v = Math.round(a + (target - a) * eased)
      from.current = v
      setShown(v)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    step()
    return () => cancelAnimationFrame(raf)
  }, [target])
  const [floats, setFloats] = useState<Array<{ amount: number; key: number }>>([])
  const c = change.value
  useEffect(() => {
    if (!c) return
    setFloats((f) => [...f, c].slice(-4))
    const t = window.setTimeout(() => setFloats((f) => f.filter((x) => x.key !== c.key)), 1400)
    return () => window.clearTimeout(t)
  }, [c?.key])
  return (
    <div style={{ position: 'relative' }}>
      <ui.Pill>
        <span>🔔</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatBells(shown)}</span>
      </ui.Pill>
      {floats.map((f) => (
        <span key={f.key} class="cl-bells-float" style={{ color: f.amount > 0 ? '#3fa57a' : '#d9774a' }}>
          {f.amount > 0 ? '+' : '−'}
          {formatBells(Math.abs(f.amount))} 🔔
        </span>
      ))}
    </div>
  )
}

function SellBox({ api, cfg, wallet, market }: { api: PluginApi; cfg: Config; wallet: Wallet; market: Market }) {
  const inv = api.services.get('items:inventory')
  inv.version.value // re-render on pocket changes
  wallet.bells.value
  const [sold, setSold] = useState<string | null>(null)
  const items = api.registry('items')
  const actor = [...api.entities.world.with('player', 'transform')][0]
  if (!actor) return <div>Некому продавать.</div>
  const museum = api.services.has('museum:donations') ? api.services.get('museum:donations') : null
  const catalog = api.services.has('collection:catalog') ? api.services.get('collection:catalog') : null
  const missing = (id: string) => !!museum && !!catalog?.get(id) && !museum.has(id)
  const price = (id: string) => market.sellPrice(id)
  const trend = (id: string) => {
    const c = market.categoryOf(id)
    const m = c ? market.demand(c) : 1
    return Math.abs(m - 1) < 0.01 ? '' : ` · ${m > 1 ? '📈' : '📉'} ${formatDemand(m)}`
  }

  // one row per item id (stacks of the same item are summed)
  const counts = new Map<string, number>()
  for (const s of inv.of(actor)?.slots ?? []) {
    if (!s || price(s.id) <= 0 || cfg.keepTags.some((t) => items.isTagged(s.id, t))) continue
    counts.set(s.id, (counts.get(s.id) ?? 0) + s.count)
  }
  const sell = (id: string, n: number) => {
    const got = inv.remove(actor, id, n)
    if (!got) return 0
    const pay = price(id) * got
    wallet.add(pay)
    api.events.emit('economy:sold', { actor, id, count: got, bells: pay })
    return pay
  }
  const done = (pay: number, what: string) => {
    if (!pay) return
    api.audio.play('economy:coins')
    setSold(`${what} — +${formatBells(pay)} 🔔`)
  }
  const sellAll = () => {
    let pay = 0
    for (const [id, n] of counts) if (!(cfg.keepUndonated && missing(id))) pay += sell(id, n)
    done(pay, 'Продано всё')
  }
  const total = [...counts].reduce((s, [id, n]) => s + (cfg.keepUndonated && missing(id) ? 0 : price(id) * n), 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: 'min(520px, 86vw)' }}>
      {counts.size ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '50vh', overflowY: 'auto' }}>
          {[...counts].map(([id, n]) => (
            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <ui.ItemSlot icon={api.ui.itemIcon(id)} count={n} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800 }}>{items.get(id)?.name ?? id}</div>
                <div style={{ fontSize: '12px', color: 'var(--ui-text-soft)' }}>
                  {formatBells(price(id))} 🔔 за штуку{trend(id)}
                  {missing(id) ? ' · 🏛 этого ещё нет в музее' : ''}
                </div>
              </div>
              <ui.Button secondary onClick={() => done(sell(id, 1), items.get(id)?.name ?? id)}>
                Продать 1
              </ui.Button>
              {n > 1 && (
                <ui.Button secondary onClick={() => done(sell(id, n), `${items.get(id)?.name ?? id} ×${n}`)}>
                  Все
                </ui.Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: 'var(--ui-text-soft)', fontSize: '13px' }}>В карманах нечего продать. Инструменты ящик не берёт.</div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', fontSize: '13px' }}>
        <span style={{ color: 'var(--ui-text-soft)' }}>{sold ?? `В кошельке ${formatBells(wallet.bells.value)} 🔔`}</span>
        {total > 0 && <ui.Button onClick={sellAll}>Продать всё · {formatBells(total)} 🔔</ui.Button>}
      </div>
      {cfg.keepUndonated && museum && <div style={{ fontSize: '12px', color: 'var(--ui-text-soft)' }}>«Продать всё» не трогает то, чего ещё нет в музее.</div>}
    </div>
  )
}

/** Today's prices with the last days as little bars. */
function MarketBoard({ market, period }: { market: Market; period: number }) {
  const days = Array.from({ length: period }, (_, i) => period - 1 - i) // oldest first
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: 'min(440px, 86vw)' }}>
      {market.categories().map((c) => {
        const today = market.demand(c)
        return (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ width: '24px', textAlign: 'center' }}>{c.icon}</span>
            <span style={{ flex: 1, fontWeight: 700 }}>{c.name}</span>
            <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: '2px', height: '22px' }}>
              {days.map((d) => {
                const m = market.demand(c, d)
                return <span key={d} title={formatDemand(m)} style={{ width: '6px', height: `${Math.round(6 + (m - 0.5) * 16)}px`, borderRadius: '2px', background: d === 0 ? 'var(--ui-accent)' : 'var(--ui-line)' }} />
              })}
            </span>
            <span style={{ width: '56px', textAlign: 'right', fontWeight: 800, color: today >= 1 ? 'var(--ui-accent)' : 'var(--ui-text-soft)' }}>{formatDemand(today)}</span>
          </div>
        )
      })}
      <div style={{ fontSize: '12px', color: 'var(--ui-text-soft)' }}>Столбики — цены за последние дни. Цены меняются каждое утро.</div>
    </div>
  )
}
