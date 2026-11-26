import { Pane, type FolderApi } from 'tweakpane'
import type { ConfigService } from '../config/ConfigService'
import { describeSchema, type FieldInfo } from '../config/schemaInfo'
import type { PlainObject } from '../util/objects'
import { createLogger } from '../util/log'

const log = createLogger('debug')

type Container = Pick<FolderApi, 'addFolder' | 'addBinding' | 'addButton'>

/**
 * Tweakpane panel generated from config schemas: every `api.config.define(schema)` gets a folder
 * with sliders/toggles/colors, plus "save to file" and "reset" buttons. No UI code per setting.
 */
export class DebugPanel {
  readonly pane: Pane
  readonly stats = { fps: 0, tick: 0, entities: 0, systems: 0 }
  private folders = new Map<string, FolderApi>()
  private refreshing = false
  private frames = 0
  private lastFpsAt = performance.now()

  constructor(private config: ConfigService) {
    this.pane = new Pane({ title: 'Compulsive Living · debug', expanded: true })
    this.pane.element.parentElement!.style.zIndex = '20'
    this.pane.element.parentElement!.style.width = '320px'
    const s = this.pane.addFolder({ title: 'stats' })
    s.addBinding(this.stats, 'fps', { readonly: true, view: 'graph', min: 0, max: 144 })
    s.addBinding(this.stats, 'tick', { readonly: true, format: (v: number) => v.toFixed(0) })
    s.addBinding(this.stats, 'entities', { readonly: true, format: (v: number) => v.toFixed(0) })
    s.addBinding(this.stats, 'systems', { readonly: true, format: (v: number) => v.toFixed(0) })

    config.onAnyChange(() => this.refresh())
  }

  /** Re-read all bound values (without echoing them back as edits). */
  refresh(): void {
    if (this.refreshing) return
    this.refreshing = true
    try {
      this.pane.refresh()
    } finally {
      this.refreshing = false
    }
  }

  set visible(v: boolean) {
    this.pane.hidden = !v
  }

  frame(): void {
    this.frames++
    const now = performance.now()
    if (now - this.lastFpsAt >= 500) {
      this.stats.fps = (this.frames * 1000) / (now - this.lastFpsAt)
      this.frames = 0
      this.lastFpsAt = now
    }
  }

  /** Add folders for new configs and drop folders of removed ones. */
  sync(): void {
    const ids = new Set(this.config.ids())
    for (const [id, f] of this.folders) {
      if (!ids.has(id)) {
        f.dispose()
        this.folders.delete(id)
      }
    }
    for (const id of [...ids].sort((a, b) => (a === 'engine' ? -1 : b === 'engine' ? 1 : a.localeCompare(b)))) {
      if (this.folders.has(id)) continue
      const folder = this.pane.addFolder({ title: `config · ${id}`, expanded: false })
      this.folders.set(id, folder)
      this.build(folder, id)
    }
  }

  /** Rebuild one config's folder (e.g. after its plugin hot-reloaded with a new schema). */
  rebuild(id: string): void {
    this.folders.get(id)?.dispose()
    this.folders.delete(id)
    this.sync()
  }

  private build(folder: FolderApi, id: string): void {
    const schema = this.config.schema(id)
    const values = this.config.get(id)
    if (!schema || !values) return
    const info = describeSchema(schema)
    if (info.kind === 'object') this.addFields(folder, values, info.fields, id)

    folder.addButton({ title: 'save → config/' + id + '.json5' }).on('click', () => {
      this.config.saveToFile(id).then(
        () => log.info(`saved config/${id}.json5`),
        (e) => log.error(e),
      )
    })
    folder.addButton({ title: 'reset to file' }).on('click', () => this.config.resetToFile(id))
    folder.addButton({ title: 'reset to defaults' }).on('click', () => this.config.resetToDefaults(id))
  }

  private addFields(parent: Container, obj: PlainObject, fields: Record<string, FieldInfo>, id: string): void {
    for (const [key, f] of Object.entries(fields)) {
      if (f.meta.hidden) continue
      // optional values that are not set (e.g. world.sea) have nothing to bind to
      if (obj[key] === undefined) continue
      const label = f.meta.label ?? key
      if (f.kind === 'object') {
        const sub = parent.addFolder({ title: label, expanded: false })
        this.addFields(sub, obj[key] as PlainObject, f.fields, id)
        continue
      }
      let opts: Record<string, unknown> | undefined
      if (f.kind === 'number') {
        opts = { min: f.meta.min ?? f.min, max: f.meta.max ?? f.max, step: f.meta.step ?? (f.int ? 1 : undefined) }
      } else if (f.kind === 'enum') {
        opts = { options: Object.fromEntries(f.options.map((o) => [o, o])) }
      } else if (f.kind === 'string' && f.meta.color) {
        opts = { view: 'color' }
      } else if (f.kind === 'other') {
        continue // arrays/records: edit in the json5 file
      }
      const binding = parent.addBinding(obj, key, { label, ...opts })
      binding.on('change', () => {
        if (!this.refreshing) this.config.notify(id)
      })
    }
  }
}
