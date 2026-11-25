import { signal } from '@preact/signals'

/** Player's preferences the UI components themselves look at. */
export const uiPrefs = {
  /** Dialogue text appears at once. */
  instantText: signal(false),
}
