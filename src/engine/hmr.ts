import type { GamePlugin } from './Game'

/** Bridge between self-accepting HMR modules and the running game (dev only). */
export interface HmrBridge {
  plugin(def: GamePlugin): void
  data(contentFiles: Record<string, string>, configFiles: Record<string, string>, assetFiles: Record<string, string>): void
  mods(text: Record<string, string>, assets: Record<string, string>): void
}

declare global {
  var __CL_HMR__: HmrBridge | undefined
}
