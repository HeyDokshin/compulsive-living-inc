# Compulsive Living

Уютная социальная песочница на воксельном острове в изометрии: воксельный мир, реальное время, сбор, рыбалка, коллекции, обустройство дома и острова, жители-соседи.

Стек: **TypeScript + Vite + three.js + miniplex (ECS) + Preact**. Вся игра собрана из плагинов поверх публичного SDK, контент описывается в JSON5.

## Запуск

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # юнит-тесты
npm run typecheck
```

## Документы

1. [Стек и выбор движка](docs/01-stack.md)
2. [Архитектура: всё — плагин](docs/02-architecture.md)
3. [Геймплей и механики](docs/03-gameplay.md)
4. [План разработки по этапам](docs/04-roadmap.md)
5. [Как сделать плагин](docs/05-plugins.md)
