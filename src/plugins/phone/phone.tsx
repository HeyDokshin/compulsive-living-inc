/** The phone's screens: home (apps), milestones. */
import { ui, useEffect, useState, type PluginApi, type RegistryView } from '@sdk'
import type { PhoneApp } from './index'

export type Screen = 'home' | 'milestones'

const CSS = `
.cl-phone { width: min(310px, 86vw); height: min(500px, 70vh); margin: 0 0 110px 28px; display: flex; flex-direction: column;
  background: #fffaf0; border-radius: 42px; padding: 14px; box-shadow: 0 0 0 7px #f3e6d0, 0 0 0 9px #e2d2b8, 0 18px 50px rgba(70, 50, 30, 0.35);
  color: var(--ui-text); font-family: var(--ui-font); }
.cl-phone-bar { display: flex; justify-content: space-between; align-items: center; padding: 6px 12px 10px; font-size: 13px; font-weight: 800; }
.cl-phone-chips { display: flex; gap: 6px; }
.cl-phone-chip { padding: 3px 9px; border-radius: 999px; background: #f4ead8; font-size: 12px; font-weight: 800; font-variant-numeric: tabular-nums; }
.cl-phone-body { flex: 1; overflow-y: auto; padding: 6px 4px 4px; border-radius: 30px; background: linear-gradient(180deg, #fdf3e1, #f7ead4); }
.cl-phone-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px 8px; padding: 14px 6px; }
.cl-phone-app { display: flex; flex-direction: column; align-items: center; gap: 6px; background: none; border: none; cursor: pointer;
  font: inherit; color: inherit; padding: 4px; border-radius: 18px; }
.cl-phone-app:hover .cl-phone-tile, .cl-phone-app:focus-visible .cl-phone-tile { transform: translateY(-3px) scale(1.05); }
.cl-phone-tile { width: 62px; height: 62px; display: grid; place-items: center; font-size: 30px;
  border-radius: 34%; transition: transform 0.15s ease; box-shadow: inset 0 -4px 0 rgba(0, 0, 0, 0.08), 0 4px 10px rgba(90, 60, 30, 0.15); }
.cl-phone-label { font-size: 12px; font-weight: 700; text-align: center; line-height: 1.15; }
.cl-phone-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px 4px; font-weight: 800; font-size: 16px; }
.cl-phone-back { border: none; background: #f1e4cc; width: 32px; height: 32px; border-radius: 50%; font-size: 16px; cursor: pointer; color: inherit; }
.cl-ms { margin: 8px 6px; padding: 10px 12px; border-radius: 22px; background: #fffaf0; box-shadow: 0 2px 8px rgba(90, 60, 30, 0.1); }
.cl-ms-top { display: flex; gap: 10px; align-items: center; }
.cl-ms-icon { font-size: 24px; width: 40px; height: 40px; display: grid; place-items: center; border-radius: 34%; background: #fff0c8; }
.cl-ms-name { font-weight: 800; font-size: 14px; }
.cl-ms-text { font-size: 12px; color: var(--ui-text-soft); }
.cl-ms-track { position: relative; height: 22px; margin: 10px 8px 2px; }
.cl-ms-line { position: absolute; left: 0; right: 0; top: 9px; height: 4px; border-radius: 2px; background: #ecdfc8; }
.cl-ms-fill { position: absolute; left: 0; top: 9px; height: 4px; border-radius: 2px; background: #7fcfa0; transition: width 0.4s ease; }
.cl-ms-dot { position: absolute; top: 3px; width: 16px; height: 16px; margin-left: -8px; border-radius: 50%; background: #ecdfc8;
  border: 3px solid #fffaf0; box-sizing: border-box; }
.cl-ms-dot.done { background: #f2b84b; }
.cl-ms-foot { display: flex; justify-content: space-between; font-size: 11px; color: var(--ui-text-soft); font-weight: 700; }
.cl-phone-button { pointer-events: auto; display: flex; flex-direction: column; align-items: center; gap: 4px; border: none; background: none;
  cursor: pointer; padding: 0; margin-right: 6px; }
.cl-phone-button-screen { width: 46px; height: 64px; border-radius: 16px; background: #fffaf0; display: grid; grid-template-columns: 1fr 1fr;
  gap: 4px; padding: 9px 8px; box-sizing: border-box; box-shadow: 0 0 0 3px #f3e6d0, 0 6px 16px rgba(70, 50, 30, 0.3); transition: transform 0.15s ease; }
.cl-phone-button:hover .cl-phone-button-screen { transform: translateY(-3px) rotate(-3deg); }
.cl-phone-button-screen i { border-radius: 34%; }
`

let styled = false
/** The phone's look (once per page). */
export function useStyle(): void {
  if (styled || typeof document === 'undefined') return
  styled = true
  const s = document.createElement('style')
  s.textContent = CSS
  document.head.appendChild(s)
}

export function Phone({ api, apps, screen }: { api: PluginApi; apps: RegistryView<PhoneApp>; screen: { value: Screen } }) {
  useStyle()
  const [, tick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])
  const now = api.time.now()
  const time = `${String(Math.floor(now.hour)).padStart(2, '0')}:${String(now.minute).padStart(2, '0')}`
  const bells = api.services.has('economy:wallet') ? api.services.get('economy:wallet').bells.value : null
  const leaves = api.services.has('quests:progress') ? api.services.get('quests:progress').points.value : null
  return (
    <div class="cl-phone">
      <div class="cl-phone-bar">
        <span>{time}</span>
        <span class="cl-phone-chips">
          {bells !== null && <span class="cl-phone-chip">🔔 {bells.toLocaleString('ru-RU')}</span>}
          {leaves !== null && <span class="cl-phone-chip">🍃 {leaves.toLocaleString('ru-RU')}</span>}
        </span>
      </div>
      <div class="cl-phone-body">
        {screen.value === 'home' && <Home api={api} apps={apps} screen={screen} />}
        {screen.value === 'milestones' && <Milestones api={api} back={() => (screen.value = 'home')} />}
      </div>
    </div>
  )
}

function Home({ api, apps, screen }: { api: PluginApi; apps: RegistryView<PhoneApp>; screen: { value: Screen } }) {
  const list = apps
    .all()
    .filter((a) => a.screen || (a.window && api.ui.hasWindow(a.window)))
    .sort((a, b) => a.order - b.order)
  return (
    <div class="cl-phone-grid">
      {list.map((a) => (
        <button
          type="button"
          key={a.id}
          class="cl-phone-app"
          onClick={() => {
            if (a.screen) screen.value = a.screen
            else if (a.window) api.ui.open(a.window)
          }}
        >
          <span class="cl-phone-tile" style={{ background: a.color }}>
            {a.icon}
          </span>
          <span class="cl-phone-label">{a.name}</span>
        </button>
      ))}
    </div>
  )
}

/** Each achievement as a track of milestones: a dot per tier, filled as far as the stat goes. */
function Milestones({ api, back }: { api: PluginApi; back: () => void }) {
  const progress = api.services.has('quests:progress') ? api.services.get('quests:progress') : null
  progress?.points.value // re-render as points come in
  const list = progress?.milestones() ?? []
  const reached = list.reduce((n, m) => n + m.tier, 0)
  const total = list.reduce((n, m) => n + m.tiers.length, 0)
  return (
    <div>
      <div class="cl-phone-head">
        <button type="button" class="cl-phone-back" aria-label="Назад" onClick={back}>
          ←
        </button>
        <span>Вехи</span>
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--ui-text-soft)' }}>
          {reached} из {total}
        </span>
      </div>
      {!list.length && <div class="cl-ms">Пока здесь пусто.</div>}
      {list.map((m) => {
        const top = m.tiers[m.tiers.length - 1] ?? 1
        const next = m.tiers[m.tier]
        // dots along the track at their thresholds; the fill follows the stat
        return (
          <div class="cl-ms" key={m.id}>
            <div class="cl-ms-top">
              <span class="cl-ms-icon">{m.icon}</span>
              <div>
                <div class="cl-ms-name">{m.name}</div>
                <div class="cl-ms-text">{m.text.replace('{value}', m.value.toLocaleString('ru-RU'))}</div>
              </div>
            </div>
            <div class="cl-ms-track">
              <div class="cl-ms-line" />
              <div class="cl-ms-fill" style={{ width: `${Math.min(100, (m.value / top) * 100)}%` }} />
              {m.tiers.map((t, i) => (
                <span key={t} class={`cl-ms-dot${i < m.tier ? ' done' : ''}`} style={{ left: `${(t / top) * 100}%` }} title={`${t}: +${m.points[i] ?? 0} 🍃`} />
              ))}
            </div>
            <div class="cl-ms-foot">
              <span>{m.value.toLocaleString('ru-RU')}</span>
              <span>{next !== undefined ? `до следующей: ${(next - m.value).toLocaleString('ru-RU')}` : 'все вехи пройдены ✨'}</span>
            </div>
          </div>
        )
      })}
      <div style={{ padding: '8px', textAlign: 'center' }}>
        <ui.Button secondary onClick={back}>
          Назад
        </ui.Button>
      </div>
    </div>
  )
}
