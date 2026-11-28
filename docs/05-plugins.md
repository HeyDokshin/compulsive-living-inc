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
| `api.input.action('jump', ['Space', 'Pad0'], 'Прыжок')` | действие ввода; `isDown`, `wasPressed`, `on`; с подписью — игрок может переназначить в настройках |
| `api.input.keyLabel('jump_mod:jump')` | что написать на клавише (следует за привязками и устройством) |
| сервис `emotes:show` | `show(entity, 'emotes:joy')`, `say(entity, 'Привет!')` — эмоция или реплика над головой; событие `emotes:shown`; эмоции — реестр `emotes:emotes` |
| `biped.action = { name, t: 0 }` | анимация: `swing`, `pickup`, `wave`, `cheer`, `nod`, `sad`, `clap` |
| `api.commands.register(...)` | команда консоли (`` ` `` / `ё`) |
| `api.render.add(object3D)` | объект сцены three.js |
| `api.world.getBlock / setBlock / isSolid / surfaceY` | воксельный мир; `setBlock` проходит через хук `world:beforeSetBlock` |
| `api.world.regenerate(seed?)` / `regenerateSoon()` | пересоздать остров |
| `api.registry('worldgen').register({ id, order, run(ctx) })` | шаг генерации мира |
| `api.textures.pattern(name, fn)` | свой процедурный паттерн текстур |
| `api.render.camera.shot` + `camera.cut(true, seconds)` | кинокадр поверх обычного вида: `target`, `zoom`, `pitch`, `yaw`, `clip` (срезать всё ближе к камере); `cut(false)` — обратно |
| `api.render.pixelsPerBlock` / `api.render.eachFace(fn)` | детализация по зуму; нарисованные лица круглых ригов (`slot.picture(texture)`) |
| `api.ui.cinema.value = true` | HUD уходит на время сцены |
| `ui.Quiet watch={значение}` / `api.ui.peek` | «тихая» часть HUD: видна несколько секунд после изменения и пока HUD «подглядывают» (телефон) |
| `api.ui.window({ …, bare: true })` / `api.ui.hasWindow(id)` | окно без рамки (рисует себя само) / есть ли такое окно |
| `api.ui.window({ …, pattern: 'stars' })` | узор за текстом окна (`dots stars hearts flowers waves checks sprinkles leaves`; по умолчанию — по id окна). В своём CSS: `background: var(--ui-pat-<узор>), <цвет>` (или `-light` на тёмном) |
| реестр `phone:apps` | приложение телефона: `{ id, name, icon, color, order, window }` — открывает окно любого плагина |
| сервис `quests:progress` | `points` (листики), `milestones()` — достижения как дорожки ступеней |
| сервис `faces:control` | `show(who, 'joy', сек)`, `mood`, `talk(who, on)`, `look(who, at)`, `ofLine(text)` — мимика (`neutral happy joy sad worried angry surprised sleepy love shy thinking wink`) |
| сервис `cutscene:talk` | `conversation(windowId, () => собеседник)` — окно-разговор крупным планом; `line(text)`, `typing(on)`; `cheat(rotY)` — повернуть к камере |
| `api.ui.slot('hud.bottomLeft', Component)` / `api.ui.window({ id, title, component })` / `api.ui.toast(text)` | интерфейс на Preact (TSX): слоты HUD, окна, сообщения; компоненты `ui.Pill`, `ui.Button`, `ui.ItemSlot`, `ui.Grid`… из `@sdk` |
| `api.registry('interactions').register({ id, tool, block, entity, when, run, label, button })` | ячейка матрицы взаимодействий; `button: 'secondary'` — вторая кнопка (F) |
| `api.interactions.at(actor, x, z)` → `find` / `perform` | что произойдёт / сделать действие в клетке |
| `api.services.provide(name, impl)` / `get(name)` | API для других плагинов (тип — через `interface Services`) |
| `api.audio.play(id, { at, volume, pitch })` | звук из реестра `sounds` (синтез или файл); `at` — тише вдали от камеры |
| `api.audio.note({ wave, freq, duration, at, bus })` / `api.audio.loop({...})` | отдельные ноты (генеративная музыка) и непрерывные звуки (прибой); `api.audio.ready` / `time` |
| `api.fx.burst(id, at, { color, amount, scale })` | частицы из реестра `particles` |
| `api.time.now()` / `hour` / `season` / `dayIndex` / `shift(ms)` | часы игры; события `time:hour`, `time:day` (`catchUp` для пропущенных дней), `time:season` |
| хук `light:adjust` | поправить свет каждый кадр (погода) |
| `api.content` | контент как данные: `registries()`, `schema(name)`, `get`, `without(name, id, mod)`, `check(name, entry)` — для редакторов |
| `api.mods` | моды игрока: `list`, `create`, `read`, `write` (сразу в игре), `exportZip` |
| слот `menu` | кнопка в Esc-меню (`api.ui.slot('menu', …)`) |
| `api.render.setWind(strength)` | как сильно качаются растения (1 — лёгкий ветерок) |
| `api.session` | имя острова и игрока (`name`, `player`), `rename(...)`; событие `session:created` — новый остров показан, пора создавать персонажа |
| `api.save.hasData` | в сейве есть данные этого плагина (нет — новый остров или плагин появился позже: пора засеять) |
| `api.render.refreshView(entity)` / `api.render.setZoom(z)` | пересобрать модель сущности после смены `model` / плавный зум |
| события `ui:opened` / `ui:closed` | окно открыто или закрыто (по ним работает обучение) |
| `api.world.pick(clientX, clientY)` / `api.input.pointer` | клетка под мышью (с учётом изгиба мира) |
| `api.render.stylize(material, { sway, flowUv })` | дать своему материалу стиль игры: изгиб мира, покачивание, течение |
| `api.render.blockSurface(blockId, rects, y)` | плоская поверхность с текстурой блока (так сделано море вокруг острова) |
| компонент `blocker: { w, d, h }` / `api.world.blockerAt(x, z)` / `updateBlocker(entity)` (после переезда сущности) | персонажи обходят сущность; `w × d` клеток вокруг её центра (дерево 1×1, музей 5×5); взаимодействие находит её из любой клетки |
| `api.interiors.define(id, { name, icon, size?, echo? })` / `area(id)` / `enter(id, actor, at)` / `exit(actor)` / `current` / `changing` / `roomAt(x, z)` | помещения — отдельные миры, загружаются при входе: шторка с названием и значком закрывает экран, мир комнаты создаётся пустым (постройте её в `area(id)` на `interior:changed`), игрок переносится, шторка открывается, когда сетка готова; на выходе — обратно к двери, лицом от неё. `size` — комната больше обычной (до 48 × 48), `echo` (0…1) — насколько в ней звенят шаги и звуки (по умолчанию `engine → interior.echo`). Комнаты лежат далеко от острова (свои координаты), поэтому всё поставленное в комнате просто стоит там; `api.world` внутри — мир комнаты, рисуется только она; остров не меняется и ждёт |
| `decor:pieces.place(piece, variant, x, z, rot, pattern?, floorY?)` | поставить вещь по правилам её слоя (ковёр под мебель, чайник на стол, картину на стену) — для обстановки комнат |
| `api.systems.add({ …, outdoors: true })` | система острова: пока игрок в помещении, она стоит (жители, насекомые, рыба, рост) |
| `api.render.material(id, size?)` | процедурный материал как готовая текстура (sRGB, повтор, мипмапы) — для своих поверхностей; общая, не удаляйте |
| сервис `rooms:kit` → `build({ box, floorY, height, doors, windows, look, floorAt? })` | вид помещения поверх невидимых блоков: обои, панели, плинтусы и карнизы, пол из материалов с тенью у стен, окна с небом часа (звёзды ночью, капли в дождь), шторы (`setCurtains`), свет из окон и пыль в лучах, бра (`setLights`), дверь с наличником и коврик; ближние к камере стены низкие |
| реестр `daily:sections` | строка в сводке дня: `{ id, order, line(api) → { icon, text } \| null }` |
| сервис `economy:wallet` | колокольчики: `bells` (сигнал), `add(n)`, `spend(n)` |
| сервис `economy:market` | цены дня: `demand(category)`, `sellPrice(item)`; категории — реестр `economy:market` (тег, размах колебаний) |
| `ui.Dialogue` / `ui.Choices` / `voiceBlip(api, pitch)` | персонаж говорит: текст печатается, «голос», варианты ответа |
| `api.render.setModel(entity, model)` | выдать или сменить модель сущности (не присваивайте `e.model` новой сущности напрямую — её не нарисуют) |
| `api.render.rigModel(id)` / `api.render.shake(amplitude, seconds)` | риг как объект three.js (части — дочерние группы по имени, их можно вращать) / лёгкая тряска камеры |
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
| 100 | `terrain:shape` | маска острова под заданную площадь, одна суша без островков, два уровня суши: земля (вровень с морем) и на блок выше → `ctx.heightMap` |
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

**Материалы вблизи.** У текстуры может быть `material` — процедурный материал из `materials.json5`; издалека остаётся пиксельный паттерн, а когда камера приближается (от `materialFrom` текселей на блок, по умолчанию 32), блок плавно получает настоящую поверхность:

```json5
// content/my_pack/materials.json5
[{ id: 'my_pack:brick', shading: 1, occlusion: 0.5, layers: [
  { kind: 'boards', colors: ['#8e3f2c', '#b5543c', '#c96a4e'], params: { rows: 6, lengths: 3, gap: 0.06 }, relief: 0.8 },
  { kind: 'grain', colors: ['#7a3424', '#e4a08a'], scale: 128, blend: 'overlay', opacity: 0.35 },
  { kind: 'noise', colors: ['#9fbf7a'], scale: 2, opacity: 0.6, mask: { scale: 3, threshold: 0.65, softness: 0.05 } },  // мох пятнами
] }]
// textures.json5: { id: 'my_pack:brick', pattern: 'planks', colors: ['#b5543c'], material: 'my_pack:brick' }
```

**Пятна на острове.** У текстуры с `material` могут быть `variants: [{ material, tint, share }]` — другие материалы мягкими пятнами по земле (клевер, луг, сухая трава): `tint` окрашивает пятно (умножением), `share` — доля земли под ним. Размер пятен и сила оттенка — `engine → render.terrain.varietyScale / varietyTint`.

Слой — узор (`fill noise ridged cells cracks strata wood boards grain fibers knit pebbles twill weave`, мотивы `stripes dots stars hearts flowers checker waves marble terrazzo scales herringbone zigzag`) через цветовую рампу `colors`, наложенный режимом `blend` (`normal multiply screen overlay soft add darken lighten`) с `opacity` и маской; `scale` — сколько деталей на тайл (целые — без швов), `octaves`, `roughness`, `warp`, `contrast`, `relief` (рельеф для запечённого света). Настройки детализации — `engine → render.detail`.

**Невидимые блоки.** `invisible: true` у блока — его не рисуют, но по нему ходят и в него упираются (если `solid`). Так устроены стены и полы помещений: их рисует набор `rooms`, а блоки дают столкновения и звук шагов.

**Поверхность у каждой модели.** Модель без своей ткани получает материал по цвету вокселей (светлое — штукатурка, серое — камень, коричневое — дерево, зелёное — листва, остальное — крашеная поверхность), сдвинутый на каждый экземпляр, чтобы соседние предметы не были одинаковыми.

**Узор поверх.** `ModelSpec.pattern: { material, color, tile }` накладывает маску материала-мотива цветом `color` поверх обычной текстуры (`tile` — повторов на модель). Так сделаны редкие предметы `decor`: узоры — данные (`content/<pack>/decor.patterns.json5`: `id`, `name`, `material`, `colors`, `weight`), каждый новый предмет мебели с шансом `decor.rareChance` выпадает узорным (`decor:<piece>_<variant>_rare_<pattern>`, тег `#decor:rare`, цена ×`rarePrice`). «Новый предмет» — хук `items:fresh` (`add(..., { fresh: true })` в магазине, крафте, подарках, событиях, заданиях): тапните его, чтобы подменить id того, что получил игрок.

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

У взаимодействия могут быть эффекты прямо в данных: `sound: 'core:dig'`, `particles: 'core:clods'`, `particleColor: 'block'` (частицы цвета блока).

Препятствия без блоков: хук `movement:blocked` (`(blocked, { x, y, z }) => boolean`) — так ямки от лопаты нужно обходить.
Иконки предметов рисуются из модели: изометрией или плоским диагональным спрайтом (для высоких тонких вещей вроде инструментов; задаётся `icon.style`).

Как предмет держится в руке и лежит на земле — тоже данные: `held: { grip: [x, y, z], tilt, scale }` (воксель модели в кулаке и наклон вперёд/назад), `ground: { lie: true }` (лечь; по умолчанию ложатся высокие тонкие предметы).

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

Плагин может перезагрузиться посреди игры (правка кода в dev или контента в редакторе): его сейверы отдают и получают данные, но `session:started` и `world:generated` не приходят. Внешний вид сущностей обновляйте на `plugin:loaded` со своим id. Если сейвер не смог прочитать или записать данные, движок сохраняет прежние.

В `start()` проверяйте `api.save.loaded`: если сессия загружена из сейва, сущности уже на месте и создавать их заново не нужно. Например, игрок и ракушки появляются только в новой игре.

## Звуки и частицы

Звуки синтезируются в браузере из слоёв, файлы не нужны (`content/core/sounds.json5`):

```json5
{ id: 'my:boop', bus: 'sfx', pitchJitter: 0.1, layers: [
  { wave: 'sine', freq: 600, freqEnd: 900, duration: 0.08, gain: 0.2 },
  { wave: 'noise', duration: 0.05, gain: 0.1, filter: { type: 'lowpass', freq: 1200 } },
] }
```

Шаги берутся из блока под ногами (`sounds: { step }` в `blocks.json5`). Громкость каналов sfx, ui и ambient задаётся в `config · engine → audio`. Частицы (`particles.json5`) — это маленькие кубики: `count`, `colors`, `size`, `speed`, `spread`, `gravity` (отрицательная — всплывают), `life`, `glow`.

## Внешность, обучение, звуковой фон

- **Причёски и цвета** — записи реестра `wardrobe:options` (`content/wardrobe/wardrobe.options.json5`): `kind: 'style'` меняет модель части рига (`model.parts.head`), `kind: 'color'` — цвет канала палитры (`h s e t p o`). Новая причёска — это новая модель головы в данных.
- **Шаги обучения** — реестр `tutorial:steps`: `{ id, order, day, text, keys, event, when }` или `check(api)`. `keys` — действия ввода (`player:use`) или просто текст. `day` — день острова, с которого шаг показывается (по умолчанию первый). Шаг засчитывается в любом порядке, даже раньше своего дня; прогресс сохраняется с островом. Команды: `tutorial reset`, `tutorial skip`, `tutorial day <n>`.
- **Музыка** — плагин `ambience`: аккорды, бас и мелодия по пентатонике, днём мажор, ночью тише и в миноре; после ~4 минут музыки пауза. Громкость: Esc → Настройки → «Музыка» и «Природа».

## Время, погода, природа

- **Время** идёт по часам устройства: за ночь деревья отрастят фрукты. Для тестов: `time 6:00`, `time +2d`, `time mode scaled` (быстрые сутки).
- **Погода** — реестр `weather:types`: `codes` (коды WMO для настоящей погоды), веса по сезонам и часам для своей (`weights`, `hours`), свет, осадки с `intensity`, `mist`, `lightning`, `wind`. Настоящую погоду берёт `plugins/weather/live.ts` (место по IP, округлённое до `real.placeStep`, хранится только в браузере), числа и адреса — в конфиге `weather.real`. `weather` показывает день по часам, `weather rain` фиксирует погоду, `weather auto` возвращает прогноз. Сервис `weather:forecast`: `current()`, `rainedOn(day)`, `live()`, `temperature()`, `wind()`.
- **Настройки плагина** — реестр `options`: `{ id, label, choices, default, hint }`, значение — `api.options.get(id)`; показываются в «Настройки → Остров» и хранятся на устройстве, не в сейве.
- **Деревья** — реестр `nature:trees` (фрукт, модель фрукта на ветках, саженец, цвета кроны по сезонам). Логика роста — чистая функция `plugins/nature/growth.ts`. Команда `trees`.
- **Цветы** — реестр `garden:species` (цвета, базовые цвета, правила скрещивания). Предметы «вид × цвет» и семена создаются из этих данных. Команда `flowers`.

## Коллекции: рыбы, насекомые, окаменелости

- **Виды** — реестр `collection:species` (`content/collection/collection.species.json5`): `kind` (fish · bug · fossil), `place` (fish: river · pond · sea; bugs: flowers · trees · air · ground · rocks · water · beach), `months` (1–12, северное полушарие), `hours` ([с, до), через полночь), `weather` (any · rain · dry), `rarity` 1–5, `size` (тень рыбы), `price`. Для каждого вида создаётся предмет с тем же id и тегом `#collection:fish` / `#collection:bugs` / `#collection:fossils`.
- **Сервис `collection:catalog`**: `available(kind, place)` — кто водится сейчас, `pick(kind, place)` — взвешенный выбор, `celebrate(actor, id)` — отдать улов (карманы, энциклопедия, сообщение, мелодия, искры). Новая механика ловли — это плагин, который решает, *где и как* ловить, и вызывает `celebrate`.
- **Сервис `terrain:water`**: `kindAt(x, z)` → `'sea' | 'river' | 'pond' | null`.
- **Модели** видов генерирует `python3 tools/models/collection.py` (для крылатых насекомых ещё и риги: тело + два крыла), здание музея и мебель зала — `tools/models/museum.py`. У вида можно задать `glow` (свечение ночью) и `flap` (`flutter` / `buzz`).
- **Смотрительница** — реплики в `content/museum/museum.dialogue.json5` (темы `museum:greet`, `museum:thanks`…, подстановки `{name}`, `{description}`, `{count}`, `{total}`); скорость текста и высота «голоса» — в настройках плагина.
- **Зал музея** — реестр `museum:layouts` (`content/museum/museum.layouts.json5`): план 16 × 16 символами (`F` аквариум, `B` террариум, `O` пьедестал, `R` стойка, `C` смотрительница, `S` вход, `D` дверь, `p`/`L` растение и лампа, `a`/`b`/`c` ковры). Экспонаты встают в слоты по порядку видов.
- Команды: `now fish river` (кто клюёт сейчас), `catch collection:carp` / `catch fish` / `catch all`, `fish`, `bugs`, `museum` (`museum place` — найти место заново).

## Магазин, крафт, поделки

- **Поделки** — реестр `decor:pieces` (`content/decor/decor.pieces.json5`): модель, цена, `variants` (палитры — символ `p` перекрашивается), `blocker`, `glow` (ореол ночью; в комнатах ещё и пятно света на полу и ближних стенах — `lampPool`, `lampReach` в конфиге), `sound` (`{ id, every, jitter }` — звук раз в `every` с: часы тикают, костёр трещит). Каждый цвет — предмет `decor:<поделка>_<цвет>` с тегом `#decor:pieces`. Сервис `decor:pieces`: `of(item)`, `itemId`, `freeCell`, `place`.
- **Рецепты** — реестр `crafting:recipes`: `piece` (поделка, цвет выбирают при крафте) или `item`, `ingredients` (`item` или `tag`), `learned: start | card`. Для `card` создаётся открытка `crafting:card_<имя>`. Верстак — поделка `decor:workbench`.
- **Лавка** — реестр `shop:shelves`: полка берёт товары по тегу или списку, `count` в день, `stock` на день, `markup`. Реплики Тоши — `shop:dialogue`.
- Модели: `python3 tools/models/decor.py` (поделки), `tools/models/shop.py` (лавка, Тоша, открытка, краска, наживка), `tools/models/economy.py` (ящик).
- **Слои поделок**: `layer: floor | rug | top | wall`, у столов `surface` (высота столешницы), `indoor` — только дома. Правила — чистый модуль `plugins/decor/layers.ts`.
- **Дом** — реестры `house:levels` (модель, размер комнаты, `attic` — мансарда наверху, кредит) и `house:finishes` (обои и полы → блоки). На уровне с мансардой у правой стены лестница: шаг на нижнюю ступень — наверх (`house:attic`, свои обои и пол, стены ниже — `atticWallHeight`), люк в полу мансарды — вниз; под лестницей и люком блок `house:stairs`, на него мебель не ставится. Команда `house up`. Модели: `python3 tools/models/house.py`.
- **Дорожки** — реестр `landscaping:paths` (предмет → блок дорожки). Терраформинг — `plugins/landscaping/terraform.ts`.
- **Сундук** — поделка `decor:chest` (плагин `storage`): у каждого свои ячейки (компонент `storage`). Хук `decor:canTake` не даёт унести непустой.
- Команды: `shop`, `market`, `bells 5000`, `recipes [all]`, `decor [all]`.

## Жители

- **Характеры** — `villagers:personalities`: `voice`, `speed`, `likes` / `dislikes` (теги), `schedule` ([с, до, занятие]: sleep · wander · plaza · garden · shore · visit).
- **Жители** — `villagers:villagers`: имя, `she`, животное, голова (`villagers:head_<животное>`), характер, присказка, цвета рига и дома.
- **Реплики** — `villagers:lines`: `{ topic, personality?, when?: { hours, weather, minHearts, maxHearts, seasons }, lines }`. Темы: hello, greet, chat, gift_love/like/neutral/dislike, gift_full, gift_back, photo, request_ask/waiting/none/thanks, leaving, stay, farewell, bye. Выбор — чистая функция `plugins/villagers/talk.ts`.
- Команды: `villagers`, `villagers add [id]`, `villagers friend <id> <очки>`, `villagers leave <id>`.

## Задания, достижения, праздники

- **Задания** — `quests:tasks`: `{ text, track, params, count: [min, max], step, points, weight }`. Трекеры: catch {kind} · interact {ids} · pick {tag} · sell · craft · talk · gift · help · donate · buy · place · pave. Новый трекер — одна строка в плагине `quests` на нужное событие.
- **Достижения** — `quests:achievements` (stat, tiers, points); **награды** — `quests:rewards`; **проекты** — `quests:projects` (`build: fountain | pier`).
- **Праздники** — `events:calendar` (`from`/`to` или `weekdays`, гость, часы, украшения, лавка) и `events:guests` (как жители: голова, цвета, реплики по темам). Команда `event <id>` включает праздник для проверки.
- Команды: `quests`, `quests points 500`, `quests done`, `quests build fountain`, `quests rating`, `event`.

## Модели и персонажи

Модель можно нарисовать прямо в данных (`content/<pack>/models.json5`): `layers` снизу вверх, в слое — ряды от задней стороны (-z) к передней (+z), в ряду — символы слева направо, `.` — пусто. `palette` сопоставляет символы цветам. 12 вокселей = 1 блок, перед модели смотрит в +z.

**Как строится вещь.** Из вокселей — не кубиками: модель раскладывается на прямоугольные бруски с мягко скошенными рёбрами (мебель, ящики, постройки), а маленькие круглые вещи, из которых выходит много мелких брусков (горшки, вазы, лампы), — мягко скругляются (`style: 'auto'`). `style: 'bevel'` или `'blocks'` выбирает способ явно. Соседние оттенки одного материала (светлая и тёмная полоска досок) сливаются в один брусок — фактуру даёт материал; явно — `parts: { seat: 'pP' }`. Настройки — `engine → render.models` (`style: 'blocks'` на низком качестве, `bevel`, `maxBoxes`, `merge`); тест `tests/thingBudget.test.ts` держит каждую вещь в бюджете треугольников (маленькие — 2000, большие — 16 000). Иконки предметов рисуются самими моделями так, как их показывает игра. Плоские вещи толщиной в воксель (ковры, картины, часы на стене) рисуются одной картинкой по цветам вокселей: мягкие цвета, ровный контур, вязка на коврах и холст на картинах (своя `fabric` у модели — сильнее).
Файлы MagicaVoxel `content/<pack>/models/<name>.vox` регистрируются автоматически как `<pack>:<name>`.

Риг (`rigs.json5`) собирает персонажа из частей: `pivot` — точка вращения внутри модели, `at` — где она стоит в риге, `parent` — родительская часть. Анимация из плагина `characters` ищет части по именам `legL legR armL armR body head` и работает для любой сущности с компонентом `biped` (`speed`: 0 — стоит, 1 — идёт, больше 1 — бежит).

```json5
model: { shape: 'rig', ref: 'core:chibi', palette: { t: '#ffc4d6' } }  // перекрасить рубашку
silhouette: { color: '#fff6fb', opacity: 0.5 }  // виден сквозь рельеф
blobShadow: { radius: 0.36 }                     // мягкая круглая тень
```

**Круглые персонажи.** `round: { subdiv: 3, smooth: 2, iso: 0.42 }` у рига — части рисуются гладкими и мягкими вместо кубиков. У моделей частей:

```json5
// мех или волосы на символах палитры: 0…1, длина и густота в вокселях
fur: { keys: { s: 1, S: 0.7 }, length: 0.9, density: 6, droop: 0.3, thickness: 0.42 },
// ткань вблизи: символ палитры → материал (берётся только его светотень, цвет остаётся из палитры)
fabric: { keys: { t: 'core:knit', p: 'core:denim' }, tile: 2.5, strength: 0.7 },
// нарисованное лицо: центр и размер на передней стороне (воксели), какие нарисованные вокселями черты оно заменяет
face: { center: [4, 3.2], size: [7.6, 5.6], front: 7, erase: { e: 's', b: 's' },
        style: { eyeGap: 1.5, eyeY: 3.5, eyeSize: 0.8, mouthY: 1.9, mouthWide: 1, lids: 0, mouth: 'none', blush: '#ff98ad', brows: false } },
```

Лицо рисует плагин `faces`: моргает, смотрит на собеседника, двигает губами, пока печатается реплика, и меняет выражение — по эмоциям (`emotes:shown`), по словам реплики или по просьбе любого плагина (`faces:control`). Реплика может начинаться с тега `[joy]` — его увидит только лицо. Всё выключается в `engine → render.characters` (`round`, `fur`, `faces`, `fabric`). Готовые ткани: `core:knit` (вязка), `core:denim` (саржа), `core:linen` (полотно), `core:tweed`.

**Разговоры крупным планом.** Окно диалога становится сценой одной строкой: `api.services.get('cutscene:talk').conversation('my:talk', () => собеседник)` (сущность или объект рига). В компоненте передайте `ui.Dialogue` `onTyping` и `onLine` в `typing`/`line` сервиса — и лица заговорят. Игрок может выключить крупные планы в настройках.

Статичные сущности, которых много (цветы, поделки), помечайте `model.instanced: true` (воксельные модели и риги): они рисуются одной пачкой на модель и палитру, но у них нет своего `view`. Чтобы такую сущность оживить, на время смените модель на обычную, как дерево, когда его трясут. Поверхности `api.render.blockSurface` с опцией `cull` рисуются, только когда попадают в кадр.

## Управление в dev-режиме

| Клавиша | |
|---|---|
| `W A S D` / стрелки / левый стик | идти (камера следует за игроком) |
| `Space` / `Pad1` | бежать |
| `E` / `Enter` / `Pad0` | действие с клеткой перед персонажем (подсказка внизу экрана); срабатывает, когда отпускаешь, а пока держишь — персонаж крадётся (насекомые не замечают) |
| `F` / `Pad2` | второе действие: повернуть поделку, забрать верстак, свет у двери дома, лопатой — насыпать / срыть землю, снять дорожку |
| ЛКМ | дойти до клетки и сделать с ней действие (или просто дойти); новые клики подхватываются на ходу, путь идёт по прямым; если держать — персонаж крадётся за курсором; наведение показывает, что произойдёт |
| `I` / `Tab` / `Pad3` | карманы |
| `R` / `Pad5` (`Pad4` — назад) | сменить инструмент в руках |
| `G` | выбросить предмет из рук |
| `C` | внешность персонажа |
| `F4` | редактор контента |
| `T` / `Pad10` | эмоции |
| стрелки, `Enter` / крестовина, A, B | меню и окна без мыши |
| `B` | энциклопедия (рыбы, насекомые, окаменелости) |
| `Esc` / `Pad9` | закрыть окно, а если окон нет — меню (сохранения, новый остров) |
| `Z` / `X` | повернуть камеру на 90° (раньше `Q` / `E`; `E` теперь — действие) |
| колесо мыши | зум |
| `` ` `` / `ё` | консоль (`help` — все команды) |
| `F2` | показать/скрыть панель настроек |

Полезные команды: `plugins`, `reload <id>`, `reload content`, `registries [name] [#tag]`, `spawn <prefab> [x y z]`, `entities`, `config <id> [path] [value]`, `pause`, `step`, `systems`, `actions`.
Игрок: `tp x z`, `tp spawn`. Предметы: `give core:apple 5`, `items [#tag]`, `holes`. Остров: `island` (площадь, лестницы, мосты, проходимость).
Мир: `seed [n]`, `regen [seed]`, `worldgen`, `getblock x y z`, `setblock x y z id`, `time 18.5`, `time speed 0.5`, `atlas`, `chunks`.
В devtools браузера доступен объект `game`.
