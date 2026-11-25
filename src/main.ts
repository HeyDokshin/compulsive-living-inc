import './engine/hmr'
import { Game, type GamePlugin } from './engine/Game'
import { config } from 'zod'
import { ru } from 'zod/locales'
import * as sdk from './sdk'
import { assetFiles, contentFiles, configFiles, modAssets, modFiles } from './dataFiles'

// Every folder in src/plugins/ with an index.ts (or index.tsx) is a plugin. Add a folder — get a plugin.
const pluginModules = import.meta.glob<{ default: GamePlugin }>('./plugins/*/index.{ts,tsx}', { eager: true })

config(ru()) // messages about invalid data are shown to players (mods, the content editor)

const game = new Game(document.getElementById('app')!)

globalThis.__CL_HMR__ = {
  plugin: (def) => void game.reloadPlugins([def]),
  data: (content, config, assets) => game.reloadData(content, config, assets),
  mods: (text, assets) => void game.reloadModFolder(text, assets),
}

const splash = document.getElementById('splash')
void game
  .boot({
    plugins: Object.values(pluginModules).map((m) => m.default),
    contentFiles,
    configFiles,
    assetFiles,
    modFiles,
    modAssets,
    sdk,
  })
  .finally(() => {
    splash?.classList.add('done')
    setTimeout(() => splash?.remove(), 700)
  })

// Handy in the browser devtools: `game.entities.world.entities`
Object.assign(globalThis, { game })
