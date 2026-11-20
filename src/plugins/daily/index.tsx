/**
 * A morning note: the first time you play on a new day, a small card says what today brings —
 * weather, who can be caught, dig spots, the museum, the wallet. Each line comes from the plugin
 * that knows it, through the `daily:sections` registry:
 *
 *   api.registry('daily:sections').register({ id: 'my:line', order: 50, line: (api) => ({ icon: '🌷', text: '…' }) })
 *
 * A section returns null when it has nothing to say today.
 */
import { definePlugin, signal, ui, z, type PluginApi, type RegistryEntry, type Signal } from '@sdk'

export interface DailySection extends RegistryEntry {
  order: number
  line(api: PluginApi): { icon: string; text: string } | null
}

declare module '@sdk' {
  interface Registries {
    'daily:sections': DailySection
  }
}

const Config = z.object({
  enabled: z.boolean().default(true),
  /** Seconds after the island appears before the card opens. */
  delay: z.number().min(0).max(10).default(1.2).meta({ step: 0.1 }),
})

export default definePlugin({
  id: 'daily',
  version: '0.1.0',
  description: 'Сводка дня: погода, кого можно поймать, раскопки, музей',

  setup(api) {
    const cfg = api.config.define(Config)
    api.createRegistry<DailySection>('daily:sections')
    let lastDay = -1
    api.save.register<{ lastDay: number }>({ version: 1, save: () => ({ lastDay }), load: (d) => void (lastDay = d.lastDay) })

    // Lines are computed when the card opens (not on every render).
    const lines: Signal<Array<{ icon: string; text: string }>> = signal([])
    const collect = () => {
      const out: Array<{ icon: string; text: string }> = []
      for (const s of api.registry('daily:sections').all().sort((a, b) => a.order - b.order)) {
        try {
          const l = s.line(api)
          if (l) out.push(l)
        } catch (e) {
          api.log.warn(`daily section "${s.id}" failed:`, e)
        }
      }
      return out
    }
    let openIn = -1
    const show = () => {
      lastDay = api.time.dayIndex
      lines.value = collect()
      api.ui.open('daily:summary')
    }
    api.ui.window({ id: 'daily:summary', title: 'Новый день', component: () => <Card api={api} lines={lines} /> })

    api.events.on('session:started', () => {
      if (cfg.enabled && lastDay !== api.time.dayIndex) openIn = cfg.delay
    })
    // A new day while playing (not the catch-up of days missed while away).
    api.events.on('time:day', ({ catchUp }) => {
      if (!catchUp && cfg.enabled && lastDay !== api.time.dayIndex) openIn = cfg.delay
    })
    api.systems.add({
      id: 'open',
      phase: 'render',
      run: ({ dt }) => {
        if (openIn < 0) return
        // wait for other windows (menus, tutorial prompts) to close
        if (api.ui.modalOpen.value) return
        if ((openIn -= dt) <= 0) {
          openIn = -1
          show()
        }
      },
    })

    api.commands.register({
      name: 'daily',
      description: 'Показать сводку дня',
      run: () => {
        show()
        return 'ok'
      },
    })
  },
})

function greeting(hour: number): string {
  if (hour < 5) return 'Доброй ночи'
  if (hour < 12) return 'Доброе утро'
  if (hour < 18) return 'Добрый день'
  return 'Добрый вечер'
}

const SEASONS: Record<string, string> = { spring: 'весна 🌸', summer: 'лето ☀️', autumn: 'осень 🍂', winter: 'зима ❄️' }

function Card({ api, lines }: { api: PluginApi; lines: Signal<Array<{ icon: string; text: string }>> }) {
  const now = api.time.now()
  const date = new Date(now.ms).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: 'min(460px, 86vw)' }}>
      <div>
        <div style={{ fontWeight: 800, fontSize: '18px' }}>{greeting(now.hour)}!</div>
        <div style={{ fontSize: '14px', color: 'var(--ui-text-soft)' }}>
          {date[0]!.toUpperCase() + date.slice(1)} · {SEASONS[now.season] ?? now.season}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {lines.value.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '14px', lineHeight: 1.4 }}>
            <span style={{ fontSize: '18px', width: '24px', textAlign: 'center' }}>{l.icon}</span>
            <span>{l.text}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <ui.Button onClick={() => api.ui.close()}>Хорошего дня!</ui.Button>
      </div>
    </div>
  )
}
