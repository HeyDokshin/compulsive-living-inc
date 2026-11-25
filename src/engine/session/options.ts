import { signal } from '@preact/signals'
import type { RegistryEntry } from '../registry/Registry'

/** A choice plugins add to the settings (`options` registry): kept on this device, not in saves. */
export interface OptionDef extends RegistryEntry {
  label: string
  /** A line under it; a function is asked every time the settings are drawn. */
  hint?: string | (() => string)
  order?: number
  /** Values and their names; a yes/no option has `true` and `false`. */
  choices: Array<[value: string | boolean, label: string]>
  default: string | boolean
}

/** Values the player chose, by option id. */
export class Options {
  readonly values = signal<Record<string, string | boolean>>({})

  get(id: string, fallback: string | boolean): string | boolean {
    return this.values.value[id] ?? fallback
  }
}
