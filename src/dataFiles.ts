/**
 * All content packs and config files, as raw JSON5 text.
 * This module accepts its own hot updates: editing any .json5 file reloads data without a page reload.
 */
export const contentFiles = import.meta.glob<string>('/content/**/*.json5', {
  query: '?raw',
  import: 'default',
  eager: true,
})

export const configFiles = import.meta.glob<string>('/config/*.json5', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** Binary assets as URLs: texture PNGs and MagicaVoxel models. */
export const assetFiles = {
  ...import.meta.glob<string>('/content/**/textures/**/*.png', { query: '?url', import: 'default', eager: true }),
  ...import.meta.glob<string>('/content/**/models/**/*.vox', { query: '?url', import: 'default', eager: true }),
}

/** Mods of the mods/ folder: everything readable as text (code too — it runs like an installed mod's) and assets as URLs. */
export const modFiles = import.meta.glob<string>(['/mods/**/*.json5', '/mods/**/*.json', '/mods/**/*.js', '/mods/**/*.md'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

export const modAssets = import.meta.glob<string>(['/mods/**/*.png', '/mods/**/*.vox'], { query: '?url', import: 'default', eager: true })

if (import.meta.hot) {
  const before = JSON.stringify([modFiles, modAssets])
  import.meta.hot.accept((mod) => {
    if (!mod) return
    if (JSON.stringify([mod.modFiles, mod.modAssets]) !== before) globalThis.__CL_HMR__?.mods(mod.modFiles, mod.modAssets)
    else globalThis.__CL_HMR__?.data(mod.contentFiles, mod.configFiles, mod.assetFiles)
  })
}
