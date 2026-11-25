/**
 * Mods from the command line:
 *   npm run mod -- new my_mod "Мой мод"   start a mod in mods/my_mod
 *   npm run mod -- pack my_mod            pack it into dist/mods/my_mod.zip
 */
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSON5 from 'json5'
import { writeZip } from '../src/engine/mods/zip.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const [command, id, name] = process.argv.slice(2)

if (!id || !/^[a-z][a-z0-9_]{1,31}$/.test(id)) fail('нужен id мода: a-z, 0-9 и _, первая буква — латинская')
const dir = join(root, 'mods', id)

if (command === 'new') {
  if (existsSync(dir)) fail(`mods/${id} уже есть`)
  for (const [path, text] of Object.entries(template(id, name ?? id))) {
    await mkdir(dirname(join(dir, path)), { recursive: true })
    await writeFile(join(dir, path), text)
  }
  console.log(`Готово: mods/${id}. Запустите npm run dev — мод уже в списке «Моды».`)
} else if (command === 'pack') {
  if (!existsSync(join(dir, 'mod.json5'))) fail(`нет mods/${id}/mod.json5`)
  const manifest = JSON5.parse(await readFile(join(dir, 'mod.json5'), 'utf8'))
  if (manifest.id !== id) fail(`id в mod.json5 — «${manifest.id}», а папка — «${id}»`)
  const files = {}
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue
    const path = join(entry.parentPath, entry.name)
    files[relative(dir, path).replaceAll('\\', '/')] = new Uint8Array(await readFile(path))
  }
  const out = join(root, 'dist', 'mods', `${id}.zip`)
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, writeZip(files))
  console.log(`${relative(root, out)}: ${Object.keys(files).length} файлов`)
} else fail('команды: new <id> ["Название"], pack <id>')

function fail(message) {
  console.error(message)
  process.exit(1)
}

function template(id, name) {
  return {
    'mod.json5': `{
  id: '${id}',
  name: ${JSON.stringify(name)},
  version: '1.0.0',
  author: '',
  description: '',
  sdk: 1,
  main: 'main.js', // delete this line (and main.js) for a data-only mod
  dependsOn: ['items'],
}
`,
    'content/items.json5': `// New items. Change the game's own with a patch: { patch: { 'core:apple': { price: 150 } } }
[
  { id: '${id}:trinket', name: 'Безделушка', description: 'Из мода.', stack: 10, price: 100, model: '${id}:trinket' },
]
`,
    'content/models.json5': `// layers go from the ground up, rows from back to front; letters are colors of the palette
[
  {
    id: '${id}:trinket', scale: 0.0625, palette: { a: '#ffb3c7', b: '#ff8fa8' },
    layers: [
      ['.aa.', 'aaaa', 'aaaa', '.aa.'],
      ['aaaa', 'abba', 'abba', 'aaaa'],
      ['.aa.', 'aaaa', 'aaaa', '.aa.'],
    ],
  },
]
`,
    'main.js': `// @ts-check
import { definePlugin, z } from '@sdk'

export default definePlugin({
  id: '${id}',
  dependsOn: ['items'],

  setup(api) {
    const cfg = api.config.define(z.object({ gift: z.number().int().min(0).max(10).default(1) }))

    // a present on a new island
    api.events.on('session:created', () => {
      const player = [...api.entities.world.with('player', 'transform')][0]
      if (player) api.services.get('items:inventory').add(player, '${id}:trinket', cfg.gift)
    })
  },
})
`,
  }
}
