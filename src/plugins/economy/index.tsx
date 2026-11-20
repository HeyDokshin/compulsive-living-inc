/**
 * Bells (the island's money) and the sell box. The wallet is a service other plugins pay into or
 * take from (`economy:wallet`); the box near the middle of the island buys anything with a price
 * except tools. Shops and the market come with stage 7 — they will use the same wallet.
 */
import { definePlugin, signal, ui, useState, z, type Entity, type PluginApi, type ReadonlySignal } from '@sdk'

export interface Wallet {
  readonly bells: ReadonlySignal<number>
  add(amount: number): void
  /** False (and nothing taken) when there isn't enough. */
  spend(amount: number): boolean
}

declare module '@sdk' {
  interface Components {
    sellBox?: Record<string, never>
  }
  interface Services {
    'economy:wallet': Wallet
  }
  interface GameEvents {
    'economy:sold': { actor: Entity; id: string; count: number; bells: number }
  }
}

const Config = z.object({
  startBells: z.number().int().min(0).max(1_000_000).default(0).meta({ label: 'bells on a new island', step: 100 }),
  /** Share of the item price the box pays. */
  sellRate: z.number().min(0).max(2).default(1).meta({ label: 'sell rate', step: 0.05 }),
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
  optionalDependsOn: ['museum', 'collection', 'nature', 'garden', 'daily'],

  setup(api) {
    const cfg = api.config.define(Config)
    api.components.define('sellBox', z.object({}))
    const bells = signal(0)
    const wallet: Wallet = {
      bells,
      add: (n) => void (bells.value = Math.max(0, bells.value + Math.round(n))),
      spend: (n) => {
        if (n > bells.value) return false
        bells.value -= Math.round(n)
        return true
      },
    }
    api.services.provide('economy:wallet', wallet)
    api.save.register<{ bells: number }>({ version: 1, save: () => ({ bells: bells.value }), load: (d) => void (bells.value = d.bells) })

    api.ui.slot('hud.topRight', () => <WalletPill bells={bells} />, { order: 20 })
    try {
      api.registry('daily:sections').register({ id: 'economy:wallet', order: 50, line: () => ({ icon: '🔔', text: `В кошельке ${formatBells(bells.value)} колокольчиков.` }) })
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
            if (y > 0 && free(x, z, y)) {
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
    api.ui.window({ id: 'economy:sell', title: 'Ящик для продажи', component: () => <SellBox api={api} cfg={cfg} wallet={wallet} /> })

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

function WalletPill({ bells }: { bells: ReadonlySignal<number> }) {
  return (
    <ui.Pill>
      <span>🔔</span>
      <span>{formatBells(bells.value)}</span>
    </ui.Pill>
  )
}

function SellBox({ api, cfg, wallet }: { api: PluginApi; cfg: Config; wallet: Wallet }) {
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
  const price = (id: string) => Math.round((items.get(id)?.price ?? 0) * cfg.sellRate)

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
                  {formatBells(price(id))} 🔔 за штуку{missing(id) ? ' · 🏛 этого ещё нет в музее' : ''}
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
