import './engine/hmr'
import { Game, type GamePlugin } from './engine/Game'
import { assetFiles, contentFiles, configFiles } from './dataFiles'

// Every folder in src/plugins/ with an index.ts (or index.tsx) is a plugin. Add a folder — get a plugin.
const pluginModules = import.meta.glob<{ default: GamePlugin }>('./plugins/*/index.{ts,tsx}', { eager: true })

const game = new Game(document.getElementById('app')!)

globalThis.__CL_HMR__ = {
  plugin: (def) => void game.reloadPlugins([def]),
  data: (content, config, assets) => game.reloadData(content, config, assets),
}

const splash = document.getElementById('splash')
void game
  .boot({
    plugins: Object.values(pluginModules).map((m) => m.default),
    contentFiles,
    configFiles,
    assetFiles,
  })
  .finally(() => {
    splash?.classList.add('done')
    setTimeout(() => splash?.remove(), 700)
  })

// Handy in the browser devtools: `game.entities.world.entities`
Object.assign(globalThis, { game })
