/**
 * In-game content editor (F4, or the Esc menu): browse any data registry, change entries or add new
 * ones. Nothing in the game's files changes — edits live in a mod of the player's (`api.mods`), take
 * effect at once and can be exported as a .zip. Names of registries and fields are data:
 * content/editor/editor.kinds.json5.
 */
import { definePlugin, ui, z, type RegistryEntry } from '@sdk'
import { Editor } from './ui'

export interface KindDef extends RegistryEntry {
  /** Registry this is about (none: names of fields common to all). */
  registry?: string
  label: string
  icon: string
  order: number
  fields: Record<string, string>
}

declare module '@sdk' {
  interface Registries {
    'editor:kinds': KindDef
  }
}

const Config = z.object({
  /** Entries shown in the list at once (search narrows it down). */
  listLimit: z.number().int().min(20).max(2000).default(200).meta({ label: 'list limit', step: 10 }),
})
export type EditorConfig = z.infer<typeof Config>

export default definePlugin({
  id: 'editor',
  version: '0.1.0',
  description: 'Редактор контента в игре (F4): правки складываются в свой мод',
  optionalDependsOn: ['items'],

  setup(api) {
    const cfg = api.config.define(Config)
    const kinds = api.createRegistry<KindDef>(
      'editor:kinds',
      z.looseObject({
        id: z.string(),
        registry: z.string().optional(),
        label: z.string().default(''),
        icon: z.string().default('📄'),
        order: z.number().default(1000),
        fields: z.record(z.string(), z.string()).default({}),
      }) as never,
    )
    const key = api.input.action('open', ['F4'], 'Редактор контента')
    api.input.on(key, () => api.ui.toggle('editor:main'))
    api.ui.window({ id: 'editor:main', title: 'Редактор контента', wide: true, component: () => <Editor api={api} cfg={cfg} kinds={kinds} /> })
    api.ui.slot('menu', () => (
      <ui.Button secondary onClick={() => api.ui.open('editor:main')}>
        Редактор
      </ui.Button>
    ))
    api.commands.register({
      name: 'editor',
      description: 'Открыть редактор контента',
      run: () => {
        api.ui.open('editor:main')
        return 'ok'
      },
    })
  },
})
