# 05 · Как сделать плагин

Плагин = папка `src/plugins/<id>/` с файлом `index.ts`. Игра находит её сама, регистрировать нигде не нужно.
Живые примеры: [terrain](../src/plugins/terrain/index.ts) (шаги генерации, конфиг, команды), [flora](../src/plugins/flora/index.ts) (инстансы, стиль, реакция на события), [player](../src/plugins/player/index.ts) (ввод, физика, камера, компоненты, свои события), [characters](../src/plugins/characters/index.ts) (система анимации для любого рига).

```ts
import { definePlugin, z } from '@sdk'          // только @sdk, никогда engine/*

declare module '@sdk' {                          // расширяем общие типы
  interface Components { growable?: { stage: number } }
  interface GameEvents { 'garden:grown': { uid: number } }
}

export default definePlugin({
  id: 'garden',                                  // = namespace: garden:rose, garden:grow …
  version: '0.1.0',
  dependsOn: ['terrain'],

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
| `api.ui.slot('hud.bottomLeft', Component)` / `api.ui.window({ id, title, component })` / `api.ui.toast(text)` | интерфейс на Preact (TSX): слоты HUD, окна, сообщения; компоненты `ui.Pill`, `ui.Button`, `ui.ItemSlot`, `ui.Grid`… из `@sdk` |
| `api.registry('interactions').register({ id, tool, block, entity, when, run, label })` | ячейка матрицы взаимодействий |
| `api.interactions.at(actor, x, z)` → `find` / `perform` | что произойдёт / сделать действие в клетке |
| `api.services.provide(name, impl)` / `get(name)` | API для других плагинов (тип — через `interface Services`) |
| `api.render.stylize(material, { sway, flowUv })` | дать своему материалу стиль игры: изгиб мира, покачивание, течение |
| `api.render.blockSurface(blockId, rects, y)` | плоская поверхность с текстурой блока (так сделано море вокруг острова) |
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
| 100 | `terrain:shape` | маска острова под заданную площадь, одна суша без островков, уровни террас → `ctx.heightMap` |
| 200 | `terrain:rivers` | реки к морю с водопадами → `ctx.waterMap` |
| 210 | `terrain:ponds` | пруды на ровных местах |
| 300 | `terrain:surface` | верхний блок колонны: трава, пляж, дно → `ctx.surface` |
| 400 | `terrain:voxels` | запись колонн и воды в воксели |
| 500+ | (свободно) | декор: деревья, камни, постройки — работают с вокселями |

Мир один и конечный: 128×128 (8×8 чанков, `config/world.json5`). Остров каждый раз другой по форме, но занимает одну и ту же долю мира (`terrain → island.size`) и никогда не касается края. Море за краем мира — только фон (`terrain → seaBackdrop`). Команда `island` показывает площадь.

Свой шаг между существующими: `order: 250`. Заменить шаг: `api.registry('worldgen').modify('terrain:ponds', s => ({ ...s, run: myPonds }))`. Выключить: `modify(id, s => ({ ...s, enabled: false }))`.
`ctx.rng('salt')` и `ctx.noise('salt')` детерминированы по сиду и имени — новый шаг не меняет результат остальных.

Примеры: `terrain` (остров и море), `flora` (шаг `order: 500`, инстансы травы и цветов, реакция на `world:blockChanged`).

## Блоки и текстуры

```json5
// content/my_pack/blocks.json5
[{ id: 'my_pack:brick', color: '#b5543c', textures: { all: 'my_pack:brick' } }]
// content/my_pack/textures.json5
[{ id: 'my_pack:brick', pattern: 'planks', colors: ['#b5543c'], params: { boards: 4 } }]
```

Положите `content/my_pack/textures/brick.png` (16×16), и картинка заменит процедурную текстуру `my_pack:brick`.
`transparent: true` — блок рисуется в прозрачном проходе (вода, стекло); `liquid: true` — поверхность чуть ниже края блока и текстура течёт; `tint: true` — верх блока получает мягкие солнечные и тенистые пятна (настройка `engine → render.tint`); `solid: false` — сквозь него можно пройти.
Мягкие паттерны: `soft`, `grass_top`, `grass_side` (волнистая кромка), `strata` (слои скалы), `water`.

## Предметы и взаимодействия

Предмет — это данные (`content/<pack>/items.json5`): `name`, `stack`, `model`, `tags`. Что он *делает*, задают взаимодействия — ячейки матрицы «инструмент × цель → действие»:

```ts
api.registry('interactions').register({
  id: 'garden:water_flower',
  tool: '#core:watering_cans',   // id, #тег, null = пустые руки, не указан = что угодно
  entity: 'flower',              // или block: '#core:diggable'
  priority: 10,                  // побеждает самое высокое
  label: 'Полить',               // текст подсказки (может быть функцией от контекста)
  when: (ctx) => !ctx.target!.flower!.watered,
  run: (ctx) => { ctx.target!.flower!.watered = true },   // false = ничего не произошло
})
```

Препятствия без блоков: хук `movement:blocked` (`(blocked, { x, y, z }) => boolean`) — так ямки от лопаты нужно обходить.
Иконки предметов рисуются из модели: изометрией или плоским диагональным спрайтом (для высоких тонких вещей вроде инструментов; задаётся `icon.style`).

Карманы — сервис плагина `items`: `api.services.get('items:inventory')` → `add`, `remove`, `count`, `held`, `equip`, `drop`, `spawnDrop`. Добавьте `items` в `dependsOn`.

## Сохранения

Движок сам сохраняет воксели и все сущности (их компоненты, кроме служебных вроде `view`). Плагину нужно сохранять только то, что живёт в его памяти:

```ts
api.save.register({
  version: 2,
  save: () => [...holes],                        // обычные данные (структурно клонируемые)
  load: (data) => { holes = new Map(data) },     // вызывается до start()
  migrate: (data, from) => (from === 1 ? upgradeV1(data) : data),
})
```

В `start()` проверяйте `api.save.loaded`: если сессия загружена из сейва, сущности уже на месте и создавать их заново не нужно. Например, игрок и ракушки появляются только в новой игре.

## Модели и персонажи

Модель можно нарисовать прямо в данных (`content/<pack>/models.json5`): `layers` снизу вверх, в слое — ряды от задней стороны (-z) к передней (+z), в ряду — символы слева направо, `.` — пусто. `palette` сопоставляет символы цветам. 12 вокселей = 1 блок, перед модели смотрит в +z.
Файлы MagicaVoxel `content/<pack>/models/<name>.vox` регистрируются автоматически как `<pack>:<name>`.

Риг (`rigs.json5`) собирает персонажа из частей: `pivot` — точка вращения внутри модели, `at` — где она стоит в риге, `parent` — родительская часть. Анимация из плагина `characters` ищет части по именам `legL legR armL armR body head` и работает для любой сущности с компонентом `biped` (`speed`: 0 — стоит, 1 — идёт, больше 1 — бежит).

```json5
model: { shape: 'rig', ref: 'core:chibi', palette: { t: '#ffc4d6' } }  // перекрасить рубашку
silhouette: { color: '#fff6fb', opacity: 0.5 }  // виден сквозь рельеф
blobShadow: { radius: 0.36 }                     // мягкая круглая тень
```

## Управление в dev-режиме

| Клавиша | |
|---|---|
| `W A S D` / стрелки / левый стик | идти (камера следует за игроком) |
| `Shift` / `Pad1` | бежать |
| `Space` / `Enter` / `Pad0` | действие (подсказка внизу экрана) |
| `I` / `Tab` / `Pad3` | карманы |
| `R` / `Pad5` (`Pad4` — назад) | сменить инструмент в руках |
| `G` | выбросить предмет из рук |
| `Esc` / `Pad9` | закрыть окно, а если окон нет — меню (сохранения, новый остров) |
| `Q` / `E` | повернуть камеру на 90° |
| колесо мыши | зум |
| `` ` `` / `ё` | консоль (`help` — все команды) |
| `F2` | показать/скрыть панель настроек |

Полезные команды: `plugins`, `reload <id>`, `reload content`, `registries [name] [#tag]`, `spawn <prefab> [x y z]`, `entities`, `config <id> [path] [value]`, `pause`, `step`, `systems`, `actions`.
Игрок: `tp x z`, `tp spawn`. Предметы: `give core:apple 5`, `items [#tag]`, `holes`. Остров: `island` (площадь, лестницы, мосты, проходимость).
Мир: `seed [n]`, `regen [seed]`, `worldgen`, `getblock x y z`, `setblock x y z id`, `time 18.5`, `time speed 0.5`, `atlas`, `chunks`.
В devtools браузера доступен объект `game`.
