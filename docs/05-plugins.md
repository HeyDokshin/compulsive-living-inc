# 05 · Как сделать плагин

Плагин = папка `src/plugins/<id>/` с файлом `index.ts`. Игра находит её сама, регистрировать нигде не нужно.
Живой пример со всеми точками расширения: [src/plugins/hello/index.ts](../src/plugins/hello/index.ts).

```ts
import { definePlugin, z } from '@sdk'          // только @sdk, никогда engine/*

declare module '@sdk' {                          // расширяем общие типы
  interface Components { growable?: { stage: number } }
  interface GameEvents { 'garden:grown': { uid: number } }
}

export default definePlugin({
  id: 'garden',                                  // = namespace: garden:rose, garden:grow …
  version: '0.1.0',
  dependsOn: ['hello'],

  setup(api) {                                   // регистрация
    const cfg = api.config.define(z.object({
      growSpeed: z.number().min(0).max(5).default(1).meta({ step: 0.1 }),   // → ползунок в панели F2
    }))
    api.components.define('growable', z.object({ stage: z.number().default(0) }))
    api.systems.add({ id: 'grow', phase: 'update', run: ({ dt }) => {
      for (const e of api.entities.world.with('growable')) e.growable.stage += dt * cfg.growSpeed
    }})
    api.commands.register({ name: 'grow', description: 'Вырастить всё', run: () => 'ok' })
  },

  start(api) {                                   // реестры и контент уже загружены
    api.entities.spawn('garden:rose', { transform: { x: 0, y: 1, z: 0, rotY: 0 } })
  },
})
```

## Что даёт `api`

| | |
|---|---|
| `api.registry('blocks')` / `api.createRegistry('garden:seeds', schema)` | контент: `register`, `modify`, `tag`, `get`, `tagged('#ns:tag')`, `onChange` |
| `api.entities.spawn(prefabOrComponents, overrides)` | создать сущность; `api.entities.world.with('a','b')` — запросы ECS |
| `api.components.define(name, schema)` | объявить компонент (валидация, сохранения, инспектор) |
| `api.systems.add({ id, phase, priority, run })` | фазы: `input → preUpdate → update → postUpdate` (тик 20 Гц), `render` (каждый кадр) |
| `api.events.on/emit` | «что-то случилось» |
| `api.hooks.tap(name, fn, { priority })` | «что-то вот-вот случится» — изменить значение или отменить |
| `api.config.define(schema)` | живые настройки, файл `config/<id>.json5`, панель F2 |
| `api.input.action('jump', ['Space'])` | действие ввода; `isDown`, `wasPressed`, `on` |
| `api.commands.register(...)` | команда консоли (`` ` `` / `ё`) |
| `api.render.add(object3D)` | объект сцены three.js |
| `api.world.getBlock / setBlock / isSolid / surfaceY` | воксельный мир; `setBlock` проходит через хук `world:beforeSetBlock` |
| `api.world.regenerate(seed?)` / `regenerateSoon()` | пересоздать остров |
| `api.registry('worldgen').register({ id, order, run(ctx) })` | шаг генерации мира |
| `api.textures.pattern(name, fn)` | свой процедурный паттерн текстур |
| `api.onDispose(fn)` | своя очистка |

**Всё, что зарегистрировано через `api`, удаляется автоматически**, когда плагин выгружается или перезагружается. Поэтому при сохранении файла плагин перезапускается вместе с зависимыми от него, а мир продолжает работать.

## Контент без кода

`content/<pack>/<registry>.json5` — имя файла выбирает реестр: `blocks.json5` → `blocks`, `garden.seeds.json5` → `garden:seeds`.

```json5
{
  entries: [{ id: 'garden:rose', tags: ['core:flowers'], components: { … } }],
  tags: { 'core:fruits': ['garden:mango'] },   // добавить чужие id в теги
}
```

## Генерация мира

Остров строится шагами из реестра `worldgen` по возрастанию `order`:

| order | шаг (плагин `terrain`) | что делает |
|---|---|---|
| 100 | `terrain:shape` | маска острова и уровни террас → `ctx.heightMap` |
| 200 | `terrain:rivers` | реки к морю с водопадами → `ctx.waterMap` |
| 210 | `terrain:ponds` | пруды на ровных местах |
| 300 | `terrain:surface` | верхний блок колонны: трава, пляж, дно → `ctx.surface` |
| 400 | `terrain:voxels` | запись колонн и воды в воксели |
| 500+ | (свободно) | декор: деревья, камни, постройки — работают с вокселями |

Свой шаг между существующими: `order: 250`. Заменить шаг: `api.registry('worldgen').modify('terrain:ponds', s => ({ ...s, run: myPonds }))`. Выключить: `modify(id, s => ({ ...s, enabled: false }))`.
`ctx.rng('salt')` и `ctx.noise('salt')` детерминированы по сиду и имени — новый шаг не меняет результат остальных.

## Блоки и текстуры

```json5
// content/my_pack/blocks.json5
[{ id: 'my_pack:brick', color: '#b5543c', textures: { all: 'my_pack:brick' } }]
// content/my_pack/textures.json5
[{ id: 'my_pack:brick', pattern: 'planks', colors: ['#b5543c'], params: { boards: 4 } }]
```

Положите `content/my_pack/textures/brick.png` (16×16), и картинка заменит процедурную текстуру `my_pack:brick`.
`transparent: true` — блок рисуется в прозрачном проходе (вода, стекло); `solid: false` — сквозь него можно пройти.

## Управление в dev-режиме

| Клавиша | |
|---|---|
| `W A S D` / стрелки | двигать камеру |
| `Q` / `E` | повернуть камеру на 90° |
| колесо мыши | зум |
| `` ` `` / `ё` | консоль (`help` — все команды) |
| `F2` | показать/скрыть панель настроек |
| `T` | (hello) создать крутилку |

Полезные команды: `plugins`, `reload <id>`, `reload content`, `registries [name] [#tag]`, `spawn <prefab> [x y z]`, `entities`, `config <id> [path] [value]`, `pause`, `step`, `systems`, `actions`.
Мир: `seed [n]`, `regen [seed]`, `worldgen`, `getblock x y z`, `setblock x y z id`, `time 18.5`, `time speed 0.5`, `atlas`, `chunks`.
В devtools браузера доступен объект `game`.
