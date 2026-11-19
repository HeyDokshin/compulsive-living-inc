/**
 * Appearance editor (C): hairstyle and colors of hair, skin, eyes, shirt, pants and shoes.
 * Choices come from the `wardrobe:options` registry (content/wardrobe/wardrobe.options.json5),
 * so packs can add styles and swatches. The look lives in the player's `model` component
 * (`palette` + `parts`), so it is saved with the island automatically.
 */
import { definePlugin, ui, useState, z, type ComponentChildren, type Entity, type PluginApi, type RegistryEntry } from '@sdk'

interface WardrobeOption extends RegistryEntry {
  kind: 'style' | 'color'
  name?: string
  /** style: rig part to swap and the model to put there */
  part?: string
  model?: string
  /** color: palette channel and value */
  channel?: string
  color?: string
}

declare module '@sdk' {
  interface Registries {
    'wardrobe:options': WardrobeOption
  }
}

const OptionSchema = z.looseObject({
  id: z.string(),
  tags: z.array(z.string()).optional(),
  kind: z.enum(['style', 'color']),
  name: z.string().optional(),
  part: z.string().optional(),
  model: z.string().optional(),
  channel: z.string().optional(),
  color: z.string().optional(),
})

const Config = z.object({
  /** Camera zoom while the editor is open (a close look at the character). */
  previewZoom: z.number().min(1).max(8).default(4.6).meta({ label: 'preview zoom', step: 0.1 }),
})

/** Palette channels shown in the editor, in order. */
const CHANNELS: Array<{ id: string; label: string }> = [
  { id: 'h', label: 'Волосы' },
  { id: 's', label: 'Кожа' },
  { id: 'e', label: 'Глаза' },
  { id: 't', label: 'Рубашка' },
  { id: 'p', label: 'Штаны' },
  { id: 'o', label: 'Обувь' },
]

export default definePlugin({
  id: 'wardrobe',
  version: '0.1.0',
  description: 'Редактор внешности персонажа (C)',
  dependsOn: ['player'],

  setup(api) {
    const cfg = api.config.define(Config)
    api.createRegistry<WardrobeOption>('wardrobe:options', OptionSchema as never)
    const key = api.input.action('open', ['KeyC'])
    api.input.on(key, () => !api.ui.modalOpen.value && api.ui.open('wardrobe:editor'))

    api.ui.window({
      id: 'wardrobe:editor',
      title: 'Внешность',
      backdrop: 'clear',
      align: 'right',
      component: () => <Editor api={api} />,
    })

    // Close-up while dressing up: zoom in and turn the character to face the camera.
    let savedZoom: number | null = null
    api.events.on('ui:opened', ({ id }) => {
      if (id !== 'wardrobe:editor') return
      savedZoom = api.engineConfig.camera.zoom
      api.render.setZoom(cfg.previewZoom)
      const p = player(api)
      if (p?.transform) {
        const f = api.render.camera.forwardXZ()
        p.transform.rotY = Math.atan2(-f.x, -f.z)
      }
    })
    api.events.on('ui:closed', ({ id }) => {
      if (id !== 'wardrobe:editor' || savedZoom === null) return
      api.render.setZoom(savedZoom)
      savedZoom = null
    })
  },
})

function player(api: PluginApi): Entity | undefined {
  for (const e of api.entities.world.with('player', 'model')) return e
  return undefined
}

function Editor({ api }: { api: PluginApi }) {
  const [, redraw] = useState(0)
  const p = player(api)
  if (!p?.model) return <div>Персонаж не найден.</div>
  const options = api.registry('wardrobe:options').all()
  const styles = options.filter((o) => o.kind === 'style' && o.part && o.model)
  const palette = p.model.palette ?? {}
  const parts = p.model.parts ?? {}

  const apply = (change: { palette?: Record<string, string>; parts?: Record<string, string> }) => {
    p.model = {
      ...p.model!,
      palette: { ...palette, ...change.palette },
      parts: { ...parts, ...change.parts },
    }
    api.render.refreshView(p)
    api.audio.play('ui:click')
    redraw((n) => n + 1)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '320px' }}>
      <Section label="Причёска">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {styles.map((s) => {
            const active = (parts[s.part!] ?? 'core:chibi_head') === s.model
            return (
              <button key={s.id} class={`cl-btn${active ? '' : ' secondary'}`} onClick={() => apply({ parts: { [s.part!]: s.model! } })}>
                {s.name ?? s.id}
              </button>
            )
          })}
        </div>
      </Section>
      {CHANNELS.map((ch) => {
        const swatches = options.filter((o) => o.kind === 'color' && o.channel === ch.id && o.color)
        if (!swatches.length) return null
        return (
          <Section key={ch.id} label={ch.label}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
              {swatches.map((s) => {
                const active = palette[ch.id]?.toLowerCase() === s.color!.toLowerCase()
                return (
                  <button
                    key={s.id}
                    title={s.name ?? s.color}
                    aria-label={`${ch.label}: ${s.name ?? s.color}`}
                    onClick={() => apply({ palette: { [ch.id]: s.color! } })}
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      background: s.color,
                      cursor: 'pointer',
                      border: active ? '3px solid var(--ui-accent)' : '3px solid #fff',
                      boxShadow: active ? '0 0 0 2px #fff, 0 2px 6px rgba(0,0,0,.18)' : '0 2px 5px rgba(0,0,0,.12)',
                      transform: active ? 'scale(1.1)' : 'none',
                      transition: 'transform .1s',
                    }}
                  />
                )
              })}
            </div>
          </Section>
        )
      })}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <ui.Button onClick={() => api.ui.close()}>Готово</ui.Button>
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div>
      <div style={{ fontWeight: 800, fontSize: '14px', marginBottom: '6px' }}>{label}</div>
      {children}
    </div>
  )
}
