# Cursor: копирование `.next/static` в staging

- Дата: 2026-09-23
- Ветка: `codex/cursor-canonical`, исходный HEAD `0ee6041d34dc407b7cb067a8828d7fc417f3e5a2`
- Рабочая копия: `C:\Users\user\.codex\worktrees\ayprom-cursor-canonical\site-for-kirsan`
- Статус: локальный кандидат. Без push, merge, deploy. Staging с HTML и `_next/static` всё ещё не является готовым сайтом: tracked public assets, клиентский поиск и браузерные проверки остаются следующими этапами.

## Что сделано

Если запуску передан явный каталог `.next/static`, producer копирует его дерево в `staging/site/_next/static/**`, сохраняя байты и относительные пути. Без этого пути прежний fixture-режим по-прежнему пишет только HTML, robots и sitemap.

Копируются только файлы внутри переданного каталога. `.next/server`, `.next/cache` и другие соседи не обходятся, потому что в источник передаётся сам `static`, а не весь `.next`.

До любой записи дерево читается и проверяется: traversal, Windows device names, symlink/junction (цель не читается), case-insensitive столкновения внутри набора и с уже зарезервированными путями документов, source map, RSC, размер файла и запрещённый текст в JS/CSS. Секрет не попадает в текст ошибки. При отказе на этом шаге staging не создаётся, дочерний процесс не запускается, `dist/site` не меняется. Защита staging root из `0ee6041` сохранена. Запись идёт через прежний `writeStagingFile`, поэтому junction в каталоге назначения по-прежнему отклоняется до создания внешних папок.

Отчёт получает `staticAssets` (число файлов, сумма байтов, путь, размер, SHA-256), отсортированный по пути, только когда каталог был передан. Одинаковое дерево даёт одинаковый отчёт.

## Команда

Без статики, как раньше:

```powershell
node scripts/cloudflare/static-producer-fixture.mjs
```

С искусственным деревом:

```powershell
node scripts/cloudflare/static-producer-fixture.mjs --next-static fixtures/cloudflare-static-producer/next-static
```

Фикстура содержит `chunks/app.js`, `chunks/app.css` и `media/font.woff2`. В сводке появляется `staticFileCount`. Supabase и production env не нужны.

## TDD

RED: suite `cloudflare-static-producer-static-assets` не импортировался; CLI с `--next-static` падал. Прежние два CLI-теста проходили.

GREEN: static-assets + CLI + run — 41/41.

## Ограничения

- Подмена каталога junction между проверкой и `mkdir` по-прежнему не закрыта.
- Это не deployable-сайт: нет копирования `public/`, нет клиентского поиска, нет браузерной проверки.
- Настоящий `next build` не запускался; дерево статики искусственное.
- `npm run build` по-прежнему не подтверждён без `.env.local` и здесь не требовался.
