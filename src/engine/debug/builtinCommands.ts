import JSON5 from 'json5'
import type { Game } from '../Game'
import type { CommandDef } from '../types'
import { getPath } from '../util/objects'

type Cmd = Omit<CommandDef, 'id'>

const num = (v: string | undefined, name: string): number => {
  const n = Number(v)
  if (v === undefined || Number.isNaN(n)) throw new Error(`"${name}" must be a number`)
  return n
}

/** Engine console commands. Plugins add their own with `api.commands.register`. */
export function builtinCommands(game: Game): Cmd[] {
  return [
    {
      name: 'help',
      description: 'Список команд или справка по одной',
      usage: '[command]',
      run: ([name]) => {
        if (name) {
          const c = game.devConsole?.find(name)
          if (!c) throw new Error(`no command "${name}"`)
          return `${c.name} ${c.usage ?? ''}\n  ${c.description}\n  id: ${c.id}`
        }
        return game.commands
          .all()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((c) => `${c.name.padEnd(12)} ${c.description}`)
          .join('\n')
      },
    },
    { name: 'clear', description: 'Очистить консоль', run: () => game.devConsole?.clear() },
    {
      name: 'plugins',
      description: 'Список плагинов и их состояние',
      run: () =>
        game.plugins
          .all()
          .map((p) => {
            const s = game.plugins.states.get(p.id)
            const deps = p.dependsOn?.length ? ` ← ${p.dependsOn.join(', ')}` : ''
            return `${p.id.padEnd(14)} ${(s?.state ?? (p.enabled === false ? 'disabled' : '—')).padEnd(8)} ${p.version ?? ''}${deps}${s?.reason ? '  (' + s.reason + ')' : ''}`
          })
          .join('\n'),
    },
    {
      name: 'reload',
      description: 'Перезагрузить плагин и зависимые от него (или контент: reload content)',
      usage: '<plugin id | content>',
      run: async ([id]) => {
        if (!id) throw new Error('plugin id required')
        if (id === 'content') return `content packs: ${game.reloadContent().join(', ')}`
        const def = game.plugins.get(id)
        if (!def) throw new Error(`no plugin "${id}"`)
        const ids = await game.reloadPlugins([def])
        return `reloaded: ${ids.join(', ')}`
      },
    },
    {
      name: 'registries',
      description: 'Реестры или содержимое одного',
      usage: '[name] [#tag]',
      run: ([name, tag]) => {
        if (!name) return game.registries.names().map((n) => `${n} (${game.registries.get(n).size})`).join('\n')
        const r = game.registries.get(name)
        const entries = tag ? r.tagged(tag) : r.all()
        return entries.map((e) => e.id + (e.tags?.length ? `  [${e.tags.join(' ')}]` : '')).join('\n') || '(empty)'
      },
    },
    {
      name: 'spawn',
      description: 'Создать сущность из префаба',
      usage: '<prefab id> [x y z]',
      run: ([id, x, y, z]) => {
        if (!id) throw new Error('prefab id required')
        const t = game.renderer.iso.target
        const e = game.entities.spawn(id, {
          transform: {
            x: x !== undefined ? num(x, 'x') : Math.round(t.x),
            y: y !== undefined ? num(y, 'y') : 1,
            z: z !== undefined ? num(z, 'z') : Math.round(t.z),
            rotY: 0,
          },
        })
        return `spawned ${id} uid=${e.uid}`
      },
    },
    {
      name: 'entities',
      description: 'Сколько сущностей, сгруппировано по префабам',
      run: () => {
        const counts = new Map<string, number>()
        for (const e of game.entities.world) counts.set(e.prefab ?? '(no prefab)', (counts.get(e.prefab ?? '(no prefab)') ?? 0) + 1)
        return [...counts].map(([k, v]) => `${String(v).padStart(5)}  ${k}`).join('\n') || '(none)'
      },
    },
    {
      name: 'despawn',
      description: 'Удалить сущности префаба (или все: despawn all)',
      usage: '<prefab id | all>',
      run: ([id]) => {
        if (!id) throw new Error('prefab id or "all" required')
        let n = 0
        for (const e of [...game.entities.world]) {
          if (id === 'all' || e.prefab === id) {
            game.entities.despawn(e)
            n++
          }
        }
        return `despawned ${n}`
      },
    },
    {
      name: 'config',
      description: 'Показать или изменить конфиг: config engine camera.zoom 2',
      usage: '[id] [path] [value]',
      run: ([id, path, value]) => {
        if (!id) return game.config.ids().join('\n')
        const values = game.config.get(id)
        if (!values) throw new Error(`no config "${id}"`)
        if (!path) return JSON5.stringify(values, null, 2)
        if (value === undefined) return JSON5.stringify(getPath(values, path), null, 2)
        game.config.set(id, path, JSON5.parse(value))
        return `${id}.${path} = ${value}`
      },
    },
    {
      name: 'pause',
      description: 'Пауза/продолжение симуляции',
      run: () => {
        game.loop.paused = !game.loop.paused
        return game.loop.paused ? 'paused' : 'resumed'
      },
    },
    {
      name: 'step',
      description: 'Один тик симуляции (на паузе)',
      usage: '[count]',
      run: ([n]) => {
        const count = n ? num(n, 'count') : 1
        for (let i = 0; i < count; i++) game.loop.stepOnce()
        return `stepping ${count}`
      },
    },
    {
      name: 'systems',
      description: 'Список систем по фазам',
      run: () =>
        game.scheduler
          .list()
          .map((s) => `${s.phase.padEnd(10)} ${String(s.priority ?? 0).padStart(6)}  ${s.id}${s.enabled ? '' : '  (DISABLED)'}`)
          .join('\n'),
    },
    {
      name: 'regen',
      description: 'Сгенерировать мир заново (тот же или новый seed)',
      usage: '[seed]',
      run: async ([seed]) => {
        await game.world.regenerate(seed !== undefined ? num(seed, 'seed') : undefined)
        const r = game.world.lastReport!
        return `seed=${game.worldConfig.seed} · ${r.ms.toFixed(0)} ms`
      },
    },
    {
      name: 'worldgen',
      description: 'Шаги генерации и время последнего запуска',
      run: () => {
        const times = new Map(game.world.lastReport?.steps.map((s) => [s.id, s]) ?? [])
        return game.worldgen
          .all()
          .sort((a, b) => a.order - b.order)
          .map((s) => {
            const t = times.get(s.id)
            const state = s.enabled === false ? 'OFF' : t?.error ? 'ERROR ' + t.error : t ? `${t.ms.toFixed(1)} ms` : ''
            return `${String(s.order).padStart(5)}  ${s.id.padEnd(22)} ${state}${s.description ? '  — ' + s.description : ''}`
          })
          .join('\n')
      },
    },
    {
      name: 'getblock',
      description: 'Блок в координатах',
      usage: '<x> <y> <z>',
      run: ([x, y, z]) => game.world.getBlock(num(x, 'x'), num(y, 'y'), num(z, 'z')),
    },
    {
      name: 'setblock',
      description: 'Поставить блок (air — удалить)',
      usage: '<x> <y> <z> <block id>',
      run: ([x, y, z, id]) => {
        if (!id) throw new Error('block id required')
        return game.world.setBlock(num(x, 'x'), num(y, 'y'), num(z, 'z'), id) ? 'ok' : 'unchanged (out of bounds or cancelled)'
      },
    },
    {
      name: 'time',
      description: 'Время суток для освещения: time 18.5 (скорость: time speed 0.5)',
      usage: '[hour | speed <h/s>]',
      run: ([a, b]) => {
        if (a === 'speed') game.config.set('engine', 'light.timeSpeed', num(b, 'speed'))
        else if (a !== undefined) game.config.set('engine', 'light.time', ((num(a, 'hour') % 24) + 24) % 24)
        const l = game.engineConfig.light
        return `time ${l.time.toFixed(2)} h, speed ${l.timeSpeed} h/s${l.dayCycle ? '' : ' (day cycle off)'}`
      },
    },
    {
      name: 'atlas',
      description: 'Показать/скрыть текстурный атлас блоков',
      run: () => {
        const c = game.renderer.atlas.canvas
        if (c.isConnected) {
          c.remove()
          return 'hidden'
        }
        c.style.cssText =
          'position:fixed;left:12px;bottom:12px;width:256px;height:256px;image-rendering:pixelated;z-index:25;border:2px solid #fff;background:#000'
        document.body.appendChild(c)
        return `${game.renderer.atlas.plan.tiles.length} tiles, ${c.width}px`
      },
    },
    {
      name: 'chunks',
      description: 'Статистика чанков (меши, треугольники, в очереди)',
      run: () => {
        const s = game.renderer.chunks.stats()
        return `meshes ${s.chunks}, triangles ${s.triangles}, pending ${game.renderer.chunks.pending}, meshed total ${game.renderer.chunks.meshedCount}`
      },
    },
    {
      name: 'actions',
      description: 'Действия ввода и их клавиши',
      run: () => game.input.list().map((a) => `${a.id.padEnd(24)} ${a.keys.join(', ')}`).join('\n'),
    },
  ]
}
