/**
 * The phone: a pocket menu (Q, or the button by the clock) with apps for everything the HUD no
 * longer shows — pockets, the map, milestones, tasks, the encyclopedia, prices, the wardrobe…
 * Apps are data (content/phone/phone.apps.json5): an app opens another plugin's window, or a
 * screen of the phone itself. While the phone is out, the quiet parts of the HUD show (bells,
 * leaves, weather).
 */
import { definePlugin, signal, ui, z, type RegistryEntry } from '@sdk'
import { Phone, useStyle, type Screen } from './phone'

export interface PhoneApp extends RegistryEntry {
  name: string
  icon: string
  color: string
  order: number
  /** Window it opens (hidden when no plugin provides it). */
  window?: string
  /** Or a screen of the phone. */
  screen?: Screen
}

declare module '@sdk' {
  interface Registries {
    'phone:apps': PhoneApp
  }
}

const AppSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  color: z.string().default('#e8e2d6'),
  order: z.number().default(100),
  window: z.string().optional(),
  screen: z.enum(['milestones']).optional(),
})

export default definePlugin({
  id: 'phone',
  version: '0.1.0',
  description: 'Телефон: приложения, вехи, всё, что не нужно держать на экране',

  setup(api) {
    useStyle()
    const apps = api.createRegistry<PhoneApp>('phone:apps', AppSchema as never)
    const screen = signal<Screen>('home')
    const key = api.input.action('open', ['KeyQ', 'Pad8'], 'Телефон')
    const open = () => {
      screen.value = 'home'
      api.ui.open('phone:phone')
    }
    api.input.on(key, () => {
      if (api.ui.modalOpen.value) return
      open()
    })
    api.ui.window({
      id: 'phone:phone',
      title: 'Телефон',
      bare: true,
      align: 'left',
      backdrop: 'clear',
      component: () => <Phone api={api} apps={apps} screen={screen} />,
    })
    // the HUD shows its quiet parts while the phone is out
    api.events.on('ui:opened', ({ id }) => void (api.ui.peek.value = id === 'phone:phone'))
    api.events.on('ui:closed', ({ id }) => {
      if (id === 'phone:phone') api.ui.peek.value = false
    })
    // the button by the clock
    api.ui.slot(
      'hud.bottomLeft',
      () => (
        <button type="button" class="cl-phone-button" title={`Телефон (${api.input.keyLabel('phone:open')})`} onClick={open}>
          {/* a plain little phone: a soft body and a screen */}
          <svg width="40" height="56" viewBox="0 0 40 56" aria-hidden="true">
            <rect x="2" y="2" width="36" height="52" rx="12" fill="#fffaf0" stroke="#e8d8bc" stroke-width="3" />
            <rect x="8" y="9" width="24" height="34" rx="6" fill="#bfe6d0" />
            <circle cx="20" cy="48" r="2.2" fill="#e0cfb0" />
          </svg>
          <ui.Key>{api.input.keyLabel('phone:open')}</ui.Key>
        </button>
      ),
      { order: 0 },
    )
  },
})
