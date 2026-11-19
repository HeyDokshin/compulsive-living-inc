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

if (import.meta.hot) {
  import.meta.hot.accept((mod) => {
    if (mod) globalThis.__CL_HMR__?.data(mod.contentFiles, mod.configFiles, mod.assetFiles)
  })
}
