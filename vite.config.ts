/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import JSON5 from 'json5'

const root = fileURLToPath(new URL('.', import.meta.url))

/**
 * Dev-only endpoint: the in-game debug panel POSTs tuned values here
 * and they are written to config/<id>.json5 (then picked up by HMR).
 */
function devConfigWriter(): Plugin {
  return {
    name: 'cl-dev-config-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/config/', (req, res) => {
        const id = decodeURIComponent((req.url ?? '').replace(/^\//, ''))
        if (req.method !== 'POST' || !/^[a-z0-9_-]+$/.test(id)) {
          res.statusCode = 400
          return res.end('bad request')
        }
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', async () => {
          try {
            const data = JSON.parse(body)
            const text = `// Saved from the in-game debug panel. Safe to edit by hand.\n${JSON5.stringify(data, null, 2)}\n`
            await writeFile(resolve(root, 'config', `${id}.json5`), text)
            res.end('ok')
          } catch (e) {
            res.statusCode = 500
            res.end(String(e))
          }
        })
      })
    },
  }
}

/**
 * Makes every plugin entry (src/plugins/<id>/index.ts or .tsx) hot-swappable without boilerplate:
 * on change, the new definition is handed to the running game, which unloads and reloads
 * that plugin and its dependents. The world keeps running.
 */
function pluginHotReload(): Plugin {
  return {
    name: 'cl-plugin-hot-reload',
    apply: 'serve',
    transform(code, id) {
      if (!/\/src\/plugins\/[^/]+\/index\.tsx?$/.test(id)) return
      return (
        code +
        `\nif (import.meta.hot) { import.meta.hot.accept((m) => { if (m?.default) globalThis.__CL_HMR__?.plugin(m.default) }) }\n`
      )
    },
  }
}

export default defineConfig({
  plugins: [devConfigWriter(), pluginHotReload()],
  // UI is written in TSX with Preact.
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  resolve: {
    alias: {
      '@sdk': resolve(root, 'src/sdk/index.ts'),
      '@engine': resolve(root, 'src/engine'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
