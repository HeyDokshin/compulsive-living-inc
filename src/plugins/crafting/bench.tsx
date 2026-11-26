/** The workbench window: craft known recipes (pick a color for decor), or repaint a piece. */
import { ui, useState, type ComponentChildren, type Entity, type PluginApi } from '@sdk'
import type { Crafting, CraftingConfig, RecipeDef } from './index'
import { have, plan, tally } from './recipes'

interface Props {
  api: PluginApi
  cfg: CraftingConfig
  recipes: () => RecipeDef[]
  book: Crafting
  resultName: (r: RecipeDef) => string
}

export function Bench({ api, cfg, recipes, book, resultName }: Props) {
  const inv = api.services.get('items:inventory')
  inv.version.value // re-render on pocket changes
  const decor = api.services.get('decor:pieces')
  const items = api.registry('items')
  const [tab, setTab] = useState<'craft' | 'paint'>('craft')
  const [selected, setSelected] = useState<string | null>(null)
  const [variant, setVariant] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const actor = [...api.entities.world.with('player', 'transform')][0]
  if (!actor) return null
  const pocket = tally(inv.of(actor)?.slots ?? [])
  const hasTag = (id: string, tag: string) => items.isTagged(id, tag)

  const known = recipes().filter((r) => book.knows(r.id))
  const r = known.find((x) => x.id === selected) ?? known[0]
  const piece = r?.piece ? decor.get(r.piece) : undefined
  const v = piece?.variants.find((x) => x.id === variant) ?? piece?.variants[0]
  const resultItem = (rec: RecipeDef, vid?: string) => (rec.piece ? decor.itemId(rec.piece, vid ?? decor.get(rec.piece)?.variants[0]?.id ?? '') : (rec.item ?? ''))

  const craft = (rec: RecipeDef) => {
    const take = plan(rec.ingredients, pocket, hasTag)
    if (!take) return
    for (const [id, n] of take) inv.remove(actor, id, n)
    const out = resultItem(rec, v?.id)
    const left = inv.add(actor, out, rec.count, { quiet: true, fresh: true }) // the note below says what was made
    if (left) inv.spawnDrop(out, left, actor.transform!.x, actor.transform!.y, actor.transform!.z)
    api.audio.play('crafting:hammer')
    api.events.emit('crafting:crafted', { actor, recipe: rec.id, item: out, count: rec.count })
    setNote(`Готово: ${items.get(out)?.name ?? out}${rec.count > 1 ? ` ×${rec.count}` : ''}!`)
  }

  const tabs = (
    <div style={{ display: 'flex', gap: '8px' }}>
      <ui.Button secondary={tab !== 'craft'} onClick={() => setTab('craft')}>
        🔨 Мастерить
      </ui.Button>
      <ui.Button secondary={tab !== 'paint'} onClick={() => setTab('paint')}>
        🎨 Перекрасить ({inv.count(actor, cfg.paint)})
      </ui.Button>
    </div>
  )

  if (tab === 'paint') return <Paint api={api} cfg={cfg} actor={actor} tabs={tabs} />

  const take = r ? plan(r.ingredients, pocket, hasTag) : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: 'min(580px, 88vw)' }}>
      {tabs}
      <ui.Grid columns={7}>
        {known.map((rec) => (
          <ui.ItemSlot
            key={rec.id}
            icon={api.ui.itemIcon(resultItem(rec))}
            title={resultName(rec)}
            selected={rec.id === r?.id}
            onClick={() => (setSelected(rec.id), setVariant(null), setNote(''))}
          />
        ))}
      </ui.Grid>
      {r && (
        <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
          <ui.ItemSlot icon={api.ui.itemIcon(resultItem(r, v?.id))} count={r.count} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ fontWeight: 800, fontSize: '16px' }}>
              {resultName(r)}
              {r.count > 1 ? ` ×${r.count}` : ''}
            </div>
            {piece && piece.variants.length > 1 && (
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                {piece.variants.map((x) => (
                  <Swatch key={x.id} color={x.palette.p ?? '#ccc'} title={x.name} active={x.id === v?.id} onClick={() => setVariant(x.id)} />
                ))}
                <span style={{ fontSize: '12px', color: 'var(--ui-text-soft)' }}>{v?.name}</span>
              </div>
            )}
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {r.ingredients.map((ing, i) => {
                const n = have(ing, pocket, hasTag)
                const label = ing.item ? (items.get(ing.item)?.name ?? ing.item) : tagName(ing.tag ?? '')
                return (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '13px', color: n >= ing.count ? 'var(--ui-text)' : '#d9774a' }}>
                    {ing.item && <ui.AsyncIcon src={api.ui.itemIcon(ing.item)} size={24} />}
                    {label} {Math.min(n, ing.count)}/{ing.count}
                  </span>
                )
              })}
            </div>
          </div>
          <ui.Button disabled={!take} onClick={() => craft(r)}>
            Смастерить
          </ui.Button>
        </div>
      )}
      <div style={{ fontSize: '12px', color: 'var(--ui-text-soft)', minHeight: '16px' }}>
        {note || `Известно рецептов: ${known.length} из ${recipes().length}. Новые — на открытках в магазине.`}
      </div>
    </div>
  )
}

function Paint({ api, cfg, actor, tabs }: { api: PluginApi; cfg: CraftingConfig; actor: Entity; tabs: ComponentChildren }) {
  const inv = api.services.get('items:inventory')
  const decor = api.services.get('decor:pieces')
  const items = api.registry('items')
  const [note, setNote] = useState('')
  const paints = inv.count(actor, cfg.paint)
  const ids = [...tally(inv.of(actor)?.slots ?? []).keys()].filter((id) => (decor.of(id)?.piece.variants.length ?? 0) > 1)
  const repaint = (from: string, to: string) => {
    if (from === to || paints < 1) return
    if (inv.remove(actor, cfg.paint, 1) < 1 || inv.remove(actor, from, 1) < 1) return
    inv.add(actor, to, 1, { quiet: true })
    api.audio.play('crafting:hammer')
    setNote(`Перекрашено: ${items.get(to)?.name ?? to}`)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: 'min(580px, 88vw)' }}>
      {tabs}
      {ids.length ? (
        ids.map((id) => {
          const d = decor.of(id)!
          return (
            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <ui.ItemSlot icon={api.ui.itemIcon(id)} count={inv.count(actor, id)} />
              <span style={{ flex: 1, fontWeight: 700 }}>{items.get(id)?.name}</span>
              {d.piece.variants.map((x) => (
                <Swatch key={x.id} color={x.palette.p ?? '#ccc'} title={x.name} active={x.id === d.variant.id} onClick={() => repaint(id, decor.itemId(d.piece.id, x.id))} />
              ))}
            </div>
          )
        })
      ) : (
        <div style={{ fontSize: '13px', color: 'var(--ui-text-soft)' }}>В карманах нет поделок, которые можно перекрасить.</div>
      )}
      <div style={{ fontSize: '12px', color: 'var(--ui-text-soft)' }}>
        {note || (paints ? `Одна краска — одна перекраска. Краски: ${paints}.` : 'Нужна краска: её делают на верстаке из двух цветов.')}
      </div>
    </div>
  )
}

function Swatch(props: { color: string; title: string; active: boolean; onClick: () => void }) {
  return (
    <button
      title={props.title}
      onClick={props.onClick}
      style={{
        width: '26px',
        height: '26px',
        borderRadius: '50%',
        border: props.active ? '3px solid var(--ui-accent)' : '2px solid var(--ui-line)',
        background: props.color,
        cursor: 'pointer',
        padding: 0,
      }}
    />
  )
}

const TAG_NAMES: Record<string, string> = { '#garden:flowers': 'Любые цветы', '#core:fruits': 'Любые фрукты', '#core:materials': 'Материалы' }
function tagName(tag: string): string {
  return TAG_NAMES[tag] ?? tag
}
