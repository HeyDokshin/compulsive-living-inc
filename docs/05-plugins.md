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
| `api.registry('interactions').register({ id, tool, block, entity, when, run, label, button })` | ячейка матрицы взаимодействий; `button: 'secondary'` — вторая кнопка (F) |
| `api.interactions.at(actor, x, z)` → `find` / `perform` | что произойдёт / сделать действие в клетке |
| `api.services.provide(name, impl)` / `get(name)` | API для других плагинов (тип — через `interface Services`) |
| `api.audio.play(id, { at, volume, pitch })` | звук из реестра `sounds` (синтез или файл); `at` — тише вдали от камеры |
| `api.audio.note({ wave, freq, duration, at, bus })` / `api.audio.loop({...})` | отдельные ноты (генеративная музыка) и непрерывные звуки (прибой); `api.audio.ready` / `time` |
| `api.fx.burst(id, at, { color, amount, scale })` | частицы из реестра `particles` |
| `api.time.now()` / `hour` / `season` / `dayIndex` / `shift(ms)` | часы игры; события `time:hour`, `time:day` (`catchUp` для пропущенных дней), `time:season` |
| хук `light:adjust` | поправить свет каждый кадр (погода) |
| `api.save.hasData` | в сейве есть данные этого плагина (нет — новый остров или плагин появился позже: пора засеять) |
| `api.render.refreshView(entity)` / `api.render.setZoom(z)` | пересобрать модель сущности после смены `model` / плавный зум |
| события `ui:opened` / `ui:closed` | окно открыто или закрыто (по ним работает обучение) |
| `api.world.pick(clientX, clientY)` / `api.input.pointer` | клетка под мышью (с учётом изгиба мира) |
| `api.render.stylize(material, { sway, flowUv })` | дать своему материалу стиль игры: изгиб мира, покачивание, течение |
| `api.render.blockSurface(blockId, rects, y)` | плоская поверхность с текстурой блока (так сделано море вокруг острова) |
| компонент `blocker: { w, d, h }` / `api.world.blockerAt(x, z)` | персонажи обходят сущность; `w × d` клеток вокруг её центра (дерево 1×1, музей 5×5); взаимодействие находит её из любой клетки |
| `api.interiors.area(id)` / `enter(id, actor, at)` / `exit(actor)` / `current` | помещения (музей, позже дома): комната 16 × 16 в углу мира, где всегда море; постройте её на `interior:changed`, на выходе движок вернёт морю; внутри рисуется только она — спрячьте свои уличные объекты |
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
- **Шаги обучения** — реестр `tutorial:steps`: `{ id, order, text, keys, event, when }` или `check(api)`. Шаг засчитывается в любом порядке, прогресс сохраняется с островом. Команды: `tutorial reset`, `tutorial skip`.
- **Музыка** — плагин `ambience`: аккорды, бас и мелодия по пентатонике, днём мажор, ночью тише и в миноре; после ~4 минут музыки пауза. Громкость: Esc → Настройки → «Музыка» и «Природа».

## Время, погода, природа

- **Время** идёт по часам устройства: за ночь деревья отрастят фрукты. Для тестов: `time 6:00`, `time +2d`, `time mode scaled` (быстрые сутки).
- **Погода** — реестр `weather:types` (веса по сезонам, свет, осадки). `weather` показывает прогноз, `weather rain` фиксирует погоду, `weather auto` возвращает прогноз. Сервис `weather:forecast` отвечает, был ли дождь в нужный день.
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

- **Поделки** — реестр `decor:pieces` (`content/decor/decor.pieces.json5`): модель, цена, `variants` (палитры — символ `p` перекрашивается), `blocker`, `glow`. Каждый цвет — предмет `decor:<поделка>_<цвет>` с тегом `#decor:pieces`. Сервис `decor:pieces`: `of(item)`, `itemId`, `freeCell`, `place`.
- **Рецепты** — реестр `crafting:recipes`: `piece` (поделка, цвет выбирают при крафте) или `item`, `ingredients` (`item` или `tag`), `learned: start | card`. Для `card` создаётся открытка `crafting:card_<имя>`. Верстак — поделка `decor:workbench`.
- **Лавка** — реестр `shop:shelves`: полка берёт товары по тегу или списку, `count` в день, `stock` на день, `markup`. Реплики Тоши — `shop:dialogue`.
- Модели: `python3 tools/models/decor.py` (поделки), `tools/models/shop.py` (лавка, Тоша, открытка, краска, наживка), `tools/models/economy.py` (ящик).
- **Слои поделок**: `layer: floor | rug | top | wall`, у столов `surface` (высота столешницы), `indoor` — только дома. Правила — чистый модуль `plugins/decor/layers.ts`.
- **Дом** — реестры `house:levels` (модель, размер комнаты, кредит) и `house:finishes` (обои и полы → блоки). Модели: `python3 tools/models/house.py`.
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
| `Space` / `Enter` / `Pad0` | действие с клеткой перед персонажем (подсказка внизу экрана) |
| `F` / `Pad2` | второе действие: повернуть поделку, забрать верстак, свет у двери дома, лопатой — насыпать / срыть землю, снять дорожку |
| ЛКМ | дойти до клетки и сделать с ней действие (или просто дойти); наведение показывает, что произойдёт |
| `I` / `Tab` / `Pad3` | карманы |
| `R` / `Pad5` (`Pad4` — назад) | сменить инструмент в руках |
| `G` | выбросить предмет из рук |
| `C` | внешность персонажа |
| `B` | энциклопедия (рыбы, насекомые, окаменелости) |
| `Esc` / `Pad9` | закрыть окно, а если окон нет — меню (сохранения, новый остров) |
| `Q` / `E` | повернуть камеру на 90° |
| колесо мыши | зум |
| `` ` `` / `ё` | консоль (`help` — все команды) |
| `F2` | показать/скрыть панель настроек |

Полезные команды: `plugins`, `reload <id>`, `reload content`, `registries [name] [#tag]`, `spawn <prefab> [x y z]`, `entities`, `config <id> [path] [value]`, `pause`, `step`, `systems`, `actions`.
Игрок: `tp x z`, `tp spawn`. Предметы: `give core:apple 5`, `items [#tag]`, `holes`. Остров: `island` (площадь, лестницы, мосты, проходимость).
Мир: `seed [n]`, `regen [seed]`, `worldgen`, `getblock x y z`, `setblock x y z id`, `time 18.5`, `time speed 0.5`, `atlas`, `chunks`.
В devtools браузера доступен объект `game`.
