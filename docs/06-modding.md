# 06 · Моды

Мод добавляет в игру своё и меняет чужое, не трогая её файлы. Бывают моды **только из данных** (предметы, поделки, реплики) и **с кодом** (любая механика: у мода тот же API, что у встроенных плагинов).

Живой пример от начала до конца — [mods/beehives](../mods/beehives/main.js): поделка, рецепт, модели, звук, реплики, настройки, сохраняемый компонент, взаимодействие, строка в сводке дня и команда.

## Три способа

1. **В самой игре.** `F4` (или Esc → «Редактор»): выберите, что менять, поправьте поля, «Сохранить». Правки складываются в ваш мод и сразу видны; «Копия» делает новую запись; «Скачать .zip» — файл, которым можно поделиться.
2. **Готовый .zip.** Главное меню → «Моды» → «Установить .zip» (или перетащить файл) → «Применить».
3. **Папка.** `npm run mod -- new my_mod "Мой мод"` создаёт `mods/my_mod`. В `npm run dev` мод перезагружается при сохранении файла; `npm run build` встраивает папку `mods/` в `dist/index.html`. `npm run mod -- pack my_mod` упаковывает мод в `dist/mods/my_mod.zip`.

## Что внутри

```
my_mod/
  mod.json5                   описание
  content/<реестр>.json5      данные: items.json5, decor.pieces.json5, villagers.lines.json5…
  content/textures/*.png      текстуры → my_mod:<имя>
  content/models/*.vox        модели MagicaVoxel → my_mod:<имя>
  config/<плагин>.json5       свои значения настроек любого плагина
  main.js, lib/*.js           код (необязательно)
```

```json5
// mod.json5
{
  id: 'my_mod',              // a-z, 0-9, _ ; это же — пространство имён всех ваших id
  name: 'Мой мод',
  version: '1.0.0',
  author: 'Кто сделал',
  description: 'Что делает',
  sdk: 1,                    // версия SDK, для которой сделан мод
  main: 'main.js',           // без этой строки — мод только из данных
  dependsOn: ['items', 'decor'],   // плагины игры и другие моды
  enabled: true,             // для модов из папки: включён ли, пока игрок не решил иначе
}
```

## Данные

Имя файла выбирает реестр: `items.json5` → `items`, `garden.species.json5` → `garden:species`. Какие реестры есть и какие у записей поля, видно в редакторе (F4) — он строит формы по тем же схемам.

```json5
{
  entries: [{ id: 'my_mod:pie', name: 'Пирог', price: 300, model: 'my_mod:pie' }],
  patch: { 'core:apple': { price: 150, held: { scale: 1.2 } } },   // изменить чужую запись
  tags: { 'core:fruits': ['my_mod:pie'] },                         // добавить в чужой тег
}
```

`patch`: объекты сливаются, остальное (в том числе списки) заменяется целиком. Если запись после правки не проходит проверку, игра оставит исходную. Чаще всего вместо правки чужого достаточно тега: механики ссылаются на теги, а не на id.

| Реестр | Что это |
|---|---|
| `items`, `models`, `rigs`, `blocks`, `textures`, `sounds`, `particles`, `prefabs` | основа: предметы, воксельные модели, блоки, звуки |
| `decor:pieces`, `crafting:recipes` | поделки (каждый вариант становится предметом) и рецепты |
| `collection:species` | рыбы, насекомые, окаменелости |
| `garden:species`, `nature:trees` | цветы и деревья |
| `villagers:villagers`, `villagers:personalities`, `villagers:lines` | жители, характеры, реплики |
| `shop:shelves`, `economy:market` | полки лавки и цены дня |
| `quests:tasks`, `quests:achievements`, `quests:rewards`, `quests:projects` | задания, достижения, награды, проекты |
| `events:calendar`, `events:guests` | праздники и гости |
| `house:levels`, `house:finishes`, `landscaping:paths`, `weather:types`, `wardrobe:options` | дом, дорожки, погода, внешность |

## Код

`main.js` — обычный ES-модуль, сборка не нужна. Импортировать можно `@sdk` и свои файлы (`./lib/a.js`), больше ничего.

```js
// @ts-check
import { definePlugin, z } from '@sdk'

export default definePlugin({
  id: 'my_mod',                      // id мода (или my_mod_что_то, если плагинов несколько — тогда массив)
  dependsOn: ['items'],
  setup(api) {
    const cfg = api.config.define(z.object({ gift: z.number().default(1) }))   // ползунок в F2
    api.events.on('time:day', () => api.ui.toast(`Доброе утро, ${api.session.player}!`))
  },
})
```

Всё, что умеет `api`, — в [05-plugins.md](05-plugins.md). Интерфейс без JSX: `h('div', {}, 'текст')` из `@sdk`. Внутри репозитория типы работают и в `.js` (`// @ts-check`, `npm run typecheck` проверяет `mods/`); свои компоненты и события объявляйте в `types.d.ts` мода.

`@sdk` экспортирует: `definePlugin`, `z`, `h`, `Fragment`, хуки (`useState`, `useEffect`, `useMemo`, `useRef`, `useCallback`), сигналы (`signal`, `computed`, `effect`, `batch`, `useSignal`, `useComputed`), `ui` (кнопки, слоты, диалоги), `voiceBlip`, `findPath`, `deepMerge`, `downloadFile`, `JSON5`, `SDK_VERSION`.

## Правила

- **Стабильность.** Список экспортов `@sdk` закреплён тестом (`tests/sdk.test.ts`). Добавления ничего не ломают; если что-то убрано или переименовано, растёт `SDK_VERSION`, и мод, сделанный для более нового SDK, игра не загрузит.
- **Ошибки.** Сломанный мод не ломает игру: он пропускается, а причина видна в разделе «Моды». Если запуск с модами не закончился, следующий пройдёт без них.
- **Сохранения.** В сейв записывается список модов. Без мода его предметы и поделки остаются в сейве и вернутся вместе с ним; в списке островов видно, каких модов не хватает.
- **Доверие.** Код мода может всё, что может сама игра (в браузере, на этой странице). Игра предупреждает об этом при установке.
- Версии SDK: **1** — первая.
