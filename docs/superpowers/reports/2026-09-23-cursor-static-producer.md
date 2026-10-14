# Cursor: slice 3 — lifecycle дочернего процесса и staging-only crawl producer

- Дата: 2026-09-23
- Ветка: `codex/cursor-canonical`, исходный HEAD `d6bdc4586786f01a843a657e266488bbbfc35d82`
- Рабочая копия: `C:\Users\user\.codex\worktrees\ayprom-cursor-canonical\site-for-kirsan`
- Статус: локальный кандидат на интеграцию. Без push, merge, deploy, DNS, production Supabase/R2/Vercel. Это не deployable сайт и не завершённая миграция.

## Что сделано

Node-producer, который валидирует входы, создаёт уникальный staging под `dist/`, запускает собственный
дочерний HTTP-сервер, скачивает публичные ответы по route manifest с ограниченной параллельностью и
пишет детерминированный crawl report. Проверяется настоящим loopback fixture-сервером и реальными
дочерними процессами. `dist/site` не читается, не пишется и не продвигается.

### Модули (`src/cloudflare/static-build/producer/`)

| Файл | Ответственность |
|---|---|
| `types.ts` | Typed API: `StaticProducerInput`, `ChildServerSpec`, `ProducerLimits`, `CrawlReport`, `StaticProducerResult`, seam `startServer` |
| `errors.ts` | `ProducerError` (code/reason/issues/exitCode/partial/childPid); `errorCodeOf` — только код ошибки, без сообщения |
| `staging.ts` | `createStagingDirectory` (уникальный `dist/staging/<UTC>-<rand>/{site,meta}`, mkdir без recursive — нет переиспользования); `writeStagingFile` — portable path, resolve/relative, realpath-проверка родителя (junction/symlink), lstat, `wx` |
| `child-server.ts` | `startChildServer`: `spawn(shell:false, args[], windowsHide, detached на POSIX)`, allowlist env, readiness по stdout-паттерну + HTTP-probe, launch timeout, abort; `stop` — `taskkill /PID /T /F` на Windows, SIGTERM→SIGKILL по process group на POSIX, ожидание `exit` с таймаутом |
| `crawl.ts` | Пул из N воркеров, `redirect: "manual"`, `AbortSignal.any([timeout, общий signal])`, потоковое чтение тела с лимитом, ожидания по семейству (200 text/html; robots text/plain; sitemap application/xml|text/xml; `/404` через отдельный unknown probe → 404 text/html); sanitized failures |
| `report.ts` | Детерминированный `crawl-report.json`: без timestamps, URL, порта, PID; entries/failures/pendingAliases отсортированы |
| `run.ts` | Оркестрация: preflight → limits → blockers → invalid entries → `createRouteManifest` → staging → `route-manifest.json` → child → crawl → artifact policy → report → stop. Primary failure никогда не затирается cleanup failure |
| `cli.ts` | Fixture CLI: snapshot → `validateCatalogSnapshot` → `derivePublicRoutes` → `runStaticProducer` с fixture-сервером; одна JSON-строка в stdout |

### Скрипты и фикстуры

- `scripts/cloudflare/static-producer-fixture.mjs` — entrypoint. Загружает TS через встроенный type stripping Node (проверяет `process.features.typescript`).
- `scripts/cloudflare/static-producer-loader.mjs` — resolve/load hook: `@/` → `src/`, расширение `.ts`, формат `module-typescript` (чтобы не трогать `package.json` и не получать предупреждение MODULE_TYPELESS_PACKAGE_JSON).
- `scripts/cloudflare/static-producer-fixture-server.mjs` — loopback-сервер вместо `next start`: HTML по manifest, robots, sitemap, реальный 404, 308 для aliases; флаги `--status/--delay/--redirect/--body-bytes/--content-type/--never-ready/--exit-early/--ignore-sigterm` для тестов; порт 0 (эфемерный) и `Ready on http://127.0.0.1:<port>` в stdout.
- `fixtures/cloudflare-static-producer/catalog-snapshot.json` — синтетический snapshot: категории `fittings` (direct) и `pto` (brand), бренды kamaz/shacman, 2 товара, multi-brand товар `pto-shaft-110`. Без subcategory-категорий, поэтому mixed-category blocker не возникает; сам blocker в `derive-routes.ts` не тронут и не объявлен решённым.

## Воспроизводимая команда

```powershell
node scripts/cloudflare/static-producer-fixture.mjs
```

Без Supabase, без `next build/start`, без `.env`. Требует Node с type stripping (22.18+/24; здесь v24.19.0).
Результат в worktree: `dist/staging/20260923T064456Z-85fa5564/` — `site/` 17 файлов (index, catalog, about, contacts,
404.html, robots.txt, sitemap.xml, категории, бренды, category-brand, vehicle-type, 3 страницы товаров включая оба brand URL
multi-brand товара), `meta/route-manifest.json`, `meta/crawl-report.json`. `dist/` игнорируется git.

Полезные флаги: `--repo-root <dir>` (staging пойдёт в `<dir>/dist/staging`), `--git-sha <sha>`, `--concurrency <n>`,
`--server-arg <arg>` (повторяемый; пробрасывается fixture-серверу, например `--server-arg --status --server-arg /catalog=500`).
Выход 0 только если все маршруты получены и ребёнок остановлен; иначе 1 и JSON с `code`.

## TDD: RED → GREEN

RED (модули отсутствовали):

```
npx vitest run tests/cloudflare-static-producer-{run,crawl,staging,cli}.test.ts --maxWorkers=2
Test Files  4 failed (4)   Tests  2 failed (2)   exit 1
```

3 suite не импортировались (`Cannot find package '@/cloudflare/static-build/producer/*'`), 2 CLI-теста упали на отсутствующем скрипте.

GREEN после реализации (промежуточно 18/21 run-тестов: два ожидания в тестах были неверными — 2 alias вместо 1,
loopback утекает в robots/sitemap, а не в index.html; один реальный пробел — PID ребёнка терялся при readiness timeout,
исправлено через `ProducerError.childPid`):

```
Test Files  4 passed (4)   Tests  43 passed (43)   exit 0
```

Наблюдаемые сценарии на настоящем fixture-сервере/дочерних процессах: набор файлов/байтов/sha256; 404 через unknown
probe; robots/sitemap content-type; 500 → `crawl_failed`, staging сохранён, `dist/site` байт-идентичен; redirect не
следуется и Location не попадает в отчёт; медленный ответ → `request_timeout` без срыва остальных; body limit (потоково,
чтение прекращается); неверный content-type; loopback в теле → `artifact_policy_failed` без значения в результате;
concurrency ≤ N и = N; abort общего signal → `crawl_failed/aborted`, ребёнок мёртв; launch failure (ENOENT) →
`next_start_failed/spawn_failed`, staging с route-manifest остаётся; early exit с exit code; readiness timeout → ребёнок
убит; cleanup после успеха; primary + cleanup failure (primary сохраняется); только cleanup failure → `cleanup_failed`;
traversal/case collision/абсолютные/Windows device/alternate-stream пути; junction-escape; symlink-target; duplicate
output; уникальность staging; CLI end-to-end с минимальным env (PATH/SYSTEMROOT/TEMP/TMP).

## Найденные и исправленные дефекты по ходу

1. CLI завершался за ~10,9 с при 0,7 с работы: таймер `sleep(stopTimeoutMs)` в гонке с `exited` не очищался и держал event loop. Заменён на `withTimeout` с `clearTimeout`. Теперь ~0,9 с.
2. Node предупреждал о неопределённом типе модуля `.ts` (нет `"type"` в `package.json`). Решено `load`-хуком с явным `module-typescript`, без правки `package.json`.
3. Флак под нагрузкой полного suite: abort на 200 мс срабатывал до готовности ребёнка (`next_start_failed/aborted` вместо `crawl_failed/aborted`). Тест переписан: abort инициируется после готовности через seam `startServer`.

## Приёмка: команды и коды выхода

| Команда | Результат | Exit |
|---|---|---|
| `npm run lint` | чисто | 0 |
| `npm run typecheck` | чисто (потребовался cast allowlist-env к `NodeJS.ProcessEnv`, который в репозитории расширен обязательными ключами) | 0 |
| `npm run check:colors` | прямых цветов нет (274 файла) | 0 |
| `npm test -- --maxWorkers=2` | 124 файла passed, 1 skipped; 894 теста passed, 3 skipped; 66,6 с; таймаутов нет | 0 |
| `npm run test:cloudflare:static-contracts -- --maxWorkers=2` | 7 файлов, 132 теста | 0 |
| `node scripts/cloudflare/static-producer-fixture.mjs` | `{"ok":true,…"summary":{"routes":17,"written":17,"failed":0,"pendingAliases":2},"cleanup":{"ok":true,…}}` | 0 |
| `npm run build` | **не подтверждён**: нет `.env.local`; `next.config.ts` падает `TypeError: Invalid URL` (`ERR_INVALID_URL`). Production env не копировался. Изменение не касается Next-кода | 1 (env) |
| `graphify update .` | 3256 nodes, 6806 edges, 257 communities | 0 |
| `git diff --check` | чисто | 0 |
| Остаточные процессы `node … static-producer*` после тестов | 0 | — |

`npm run check` одной командой не запускался (ограничение Vitest `--maxWorkers=2`); четыре его шага выполнены отдельно.

## Политики и ограничения

- **Failure policy**: неудачный запуск оставляет свой staging (`meta/route-manifest.json`, скачанное, `meta/crawl-report.json`) для диагностики. Ничего вне этого каталога не создаётся и не удаляется; чужие staging и `dist/site` не трогаются. Promotion в этом slice нет.
- **Порт**: fixture-сервер сам выбирает эфемерный порт и сообщает его — гонки нет. Для будущего `next start` порт нужно задавать заранее (`requestedPort` в preflight): между проверкой свободного порта и bind остаётся TOCTOU-гонка, которую нельзя устранить полностью; producer при конфликте должен упасть (`next_start_failed`), а не убивать чужой процесс. Это ограничение зафиксировано, не решено.
- **Остановка на Windows**: `taskkill /T /F` — без graceful-фазы; на POSIX SIGTERM по process group, затем SIGKILL. `/T` покрывает дерево нашего ребёнка; чужие процессы не затрагиваются.
- **Env ребёнка**: только allowlist (PATH, SYSTEMROOT, WINDIR, COMSPEC, PATHEXT, TEMP/TMP/TMPDIR, HOME/USERPROFILE, LANG/LC_ALL) + явный `spec.env`. Supabase/Cloudflare/admin переменные процесса producer в ребёнка не попадают.
- **Логи/ошибки**: тела ответов, stdout/stderr ребёнка, Location, env в результатах и отчёте отсутствуют; ошибки сети — только код (`ECONNREFUSED`).
- **Отчёт**: sha256/bytes/status/contentType по маршруту; aliases `/product/<slug>` — `pendingAliases` для будущего Worker-redirect slice, HTML-дубликаты не создаются.
- **Не в scope** (по заданию): сбор JS/CSS/public assets, discovery ссылок, клиентский поиск, Next image/navigation compatibility, SEO/browser parity, promotion, Worker redirects. Интерфейс `CrawlSink`/`ChildServerSpec` изолирован, чтобы следующий slice добавил assets и gates без изменения crawl.
- **Node**: CLI требует встроенный type stripping (22.18+/24). `engines` в `package.json` допускает 20.9+ — на Node 20 CLI выйдет с кодом 2 и понятным сообщением. Vitest-тесты от этого не зависят.
- Next-документация из `node_modules/next/dist/docs/` не читалась: Next-зависимый код в этом slice не создавался.

## Предложения в чужие файлы (не применены)

1. `src/cloudflare/static-build/index.ts` — экспорт для интеграции:
   ```ts
   export { runStaticProducer, DEFAULT_PRODUCER_LIMITS } from "./producer/run";
   export type { StaticProducerInput, StaticProducerResult, CrawlReport } from "./producer/types";
   ```
2. `package.json` scripts — `"static:fixture": "node scripts/cloudflare/static-producer-fixture.mjs"`.
3. `scripts/cloudflare/README.md` — раздел о fixture-producer с командой выше.

## Файлы коммита

```
fixtures/cloudflare-static-producer/catalog-snapshot.json
scripts/cloudflare/static-producer-fixture-server.mjs
scripts/cloudflare/static-producer-fixture.mjs
scripts/cloudflare/static-producer-loader.mjs
src/cloudflare/static-build/producer/{types,errors,staging,child-server,crawl,report,run,cli}.ts
tests/cloudflare-static-producer-{run,crawl,staging,cli}.test.ts
tests/cloudflare-static-producer-support.ts
docs/superpowers/reports/2026-09-23-cursor-static-producer.md
```

Существующие contracts, `index.ts`, `derive-routes.ts`, `product-href.ts`, Worker, SQL, Next-страницы/config, `package.json`/lock, wrangler-конфиги не изменялись. Предыдущий commit `d6bdc45` сохранён.

## Исправление границ путей после review Codex

Три подтверждённые ошибки закрыты в `producer/staging.ts` и `producer/run.ts`.

- `assertStagingRootAllowed` выполняется до `mkdir`. Junction или symlink на `dist`, на промежуточном компоненте или на самом staging root отклоняется (`outside_dist_realpath`). `dist/site`, потомок и путь, чей realpath попадает в `dist/site` (включая junction-алиас и регистр `Site` на Windows), отклоняются (`site_tree_forbidden`). При отказе `stagingDir` остаётся `null`, дочерний процесс не запускается, `dist/site` не меняется.
- `writeStagingFile` больше не делает recursive mkdir до проверки. Недостающие каталоги создаются по одному уровню, и только если реальный родитель ещё внутри `siteDir`. Junction на промежуточном сегменте отклоняется до создания более глубоких каталогов, поэтому снаружи не остаётся пустой папки.
- Совпадение `EEXIST` при параллельном crawl проверяется повторным `lstat`/`realpath`: принимается только обычный каталог внутри `siteDir`.

Остаточный риск: подмена каталога junction между проверкой и `mkdir` не закрыта. Повторная проверка после создания staging уменьшает окно, но не обещает, что при такой гонке снаружи не появится пустой каталог. Уже записанные чужие файлы producer не удаляет.
