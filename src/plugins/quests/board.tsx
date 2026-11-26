/** The island board: today's tasks, rewards for leaf points, achievements, the island rating and projects. */
import { ui, useState, type Entity, type PluginApi, type RegistryView, type Signal } from '@sdk'
import type { AchievementDef, ProjectDef, QuestState, QuestsConfig, RewardDef, TaskDef } from './index'
import { tierOf, type Rating } from './logic'

interface Props {
  api: PluginApi
  cfg: QuestsConfig
  state: Signal<QuestState>
  touch: () => void
  tasks: RegistryView<TaskDef>
  achievements: RegistryView<AchievementDef>
  rewards: RegistryView<RewardDef>
  projects: RegistryView<ProjectDef>
  rating: () => Rating
  fund: (p: ProjectDef, actor: Entity) => string | null
  roll: () => void
}

type Tab = 'tasks' | 'rewards' | 'achievements' | 'island'

const bar = (share: number, color = 'var(--ui-accent)') => (
  <span style={{ display: 'block', height: '6px', borderRadius: '3px', background: 'var(--ui-line)', overflow: 'hidden' }}>
    <span style={{ display: 'block', height: '100%', width: `${Math.round(Math.min(1, share) * 100)}%`, background: color }} />
  </span>
)

export function Board(props: Props) {
  const { api } = props
  props.roll()
  const s = props.state.value
  const [tab, setTab] = useState<Tab>('tasks')
  const [note, setNote] = useState('')
  const items = api.registry('items')
  const actor = [...api.entities.world.with('player', 'transform')][0]
  const fmt = (n: number) => n.toLocaleString('ru-RU')
  const tabs: Array<[Tab, string]> = [
    ['tasks', '📋 Задания'],
    ['rewards', '🎁 Награды'],
    ['achievements', '⭐ Достижения'],
    ['island', '🏝 Остров'],
  ]

  let body = null
  if (tab === 'tasks') {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {s.tasks.map((t) => {
          const def = props.tasks.get(t.id)
          return (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', opacity: t.done ? 0.6 : 1 }}>
              <span style={{ width: '20px' }}>{t.done ? '✅' : '▫️'}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '14px' }}>{def?.text.replace('{count}', fmt(t.goal)) ?? t.id}</div>
                {bar(t.progress / t.goal)}
              </div>
              <span style={{ fontSize: '12px', color: 'var(--ui-text-soft)', width: '64px', textAlign: 'right' }}>
                {fmt(t.progress)}/{fmt(t.goal)}
              </span>
              <span style={{ fontWeight: 800, width: '56px', textAlign: 'right' }}>+{def?.points ?? 0} 🍃</span>
            </div>
          )
        })}
        <div style={{ fontSize: '12px', color: 'var(--ui-text-soft)' }}>
          {s.bonus ? 'Все задания дня выполнены — бонус получен!' : `Выполните все — и получите бонус +${props.cfg.bonus} 🍃. Новые задания — завтра утром.`}
        </div>
      </div>
    )
  } else if (tab === 'rewards') {
    const buy = (r: RewardDef) => {
      if (!actor) return
      if (s.points < r.cost) return setNote('Не хватает листиков.')
      if (r.bells) {
        if (!api.services.has('economy:wallet')) return
        api.services.get('economy:wallet').add(r.bells)
      } else if (api.services.get('items:inventory').add(actor, r.item, r.count, { quiet: true, fresh: true }) > 0) return setNote('Карманы полны.')
      s.points -= r.cost
      props.touch()
      api.audio.play('economy:coins')
      setNote(`Получено: ${r.bells ? `${fmt(r.bells)} 🔔` : `${items.get(r.item)?.name ?? r.item}${r.count > 1 ? ` ×${r.count}` : ''}`}`)
    }
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {props.rewards.all().map((r) => (
            <div key={r.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '84px', gap: '2px', opacity: s.points >= r.cost ? 1 : 0.5 }}>
              {r.bells ? (
                <div class="cl-slotbox" style={{ fontSize: '26px' }} onClick={() => buy(r)}>
                  🔔
                </div>
              ) : (
                <ui.ItemSlot icon={api.ui.itemIcon(r.item)} count={r.count} title={items.get(r.item)?.name} onClick={() => buy(r)} />
              )}
              <span style={{ fontSize: '11px', textAlign: 'center', lineHeight: 1.2 }}>{r.bells ? `${fmt(r.bells)} колокольчиков` : (items.get(r.item)?.name ?? r.item)}</span>
              <span style={{ fontSize: '11px', fontWeight: 800 }}>{fmt(r.cost)} 🍃</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--ui-text-soft)' }}>{note || `У вас ${fmt(s.points)} 🍃. Нажмите на награду, чтобы обменять.`}</div>
      </div>
    )
  } else if (tab === 'achievements') {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '50vh', overflowY: 'auto' }}>
        {props.achievements.all().map((a) => {
          const value = s.stats[a.stat] ?? 0
          const tier = tierOf(value, a.tiers)
          const next = a.tiers[tier]
          return (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '22px', width: '28px', textAlign: 'center', filter: tier ? 'none' : 'grayscale(1) opacity(.4)' }}>{a.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: '14px' }}>
                  {a.name} <span style={{ color: 'var(--ui-gold)' }}>{'★'.repeat(tier)}</span>
                  <span style={{ color: 'var(--ui-line)' }}>{'★'.repeat(a.tiers.length - tier)}</span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--ui-text-soft)' }}>
                  {a.text.replace('{value}', fmt(value))}
                  {next !== undefined ? ` · следующая ступень: ${fmt(next)}` : ' · всё собрано!'}
                </div>
                {next !== undefined && bar(value / next, 'var(--ui-gold)')}
              </div>
            </div>
          )
        })}
      </div>
    )
  } else {
    const r = props.rating()
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div>
          <div style={{ fontSize: '26px', color: 'var(--ui-gold)', letterSpacing: '2px' }}>
            {'★'.repeat(r.stars)}
            <span style={{ color: 'var(--ui-line)' }}>{'★'.repeat(5 - r.stars)}</span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--ui-text-soft)' }}>Рейтинг острова · {r.score} очков уюта</div>
          {r.tips.map((t) => (
            <div key={t} style={{ fontSize: '13px' }}>
              💡 {t}
            </div>
          ))}
        </div>
        <div style={{ fontWeight: 800, fontSize: '13px', color: 'var(--ui-text-soft)' }}>Проекты</div>
        {props.projects.all().map((p) => {
          const st = s.projects[p.id]
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800 }}>
                  {p.name} <span style={{ color: 'var(--ui-gold)', fontSize: '12px' }}>{'★'.repeat(p.stars)}</span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--ui-text-soft)' }}>
                  {p.description} {fmt(p.bells)} 🔔{p.items.map((it) => ` · ${items.get(it.item)?.name ?? it.item} ×${it.count}`).join('')}
                </div>
              </div>
              {st?.state === 'built' ? (
                <span style={{ fontWeight: 800, color: 'var(--ui-accent)' }}>Построено</span>
              ) : st?.state === 'funded' ? (
                <span style={{ fontSize: '12px' }}>🏗 К утру</span>
              ) : (
                <ui.Button disabled={!actor} onClick={() => actor && setNote(props.fund(p, actor) ?? `Строители взялись за «${p.name}» — к утру будет готово!`)}>
                  Начать
                </ui.Button>
              )}
            </div>
          )
        })}
        {note && <div style={{ fontSize: '12px' }}>{note}</div>}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: 'min(600px, 90vw)' }}>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {tabs.map(([id, label]) => (
          <ui.Button key={id} secondary={tab !== id} onClick={() => (setTab(id), setNote(''))}>
            {label}
          </ui.Button>
        ))}
      </div>
      {body}
    </div>
  )
}
