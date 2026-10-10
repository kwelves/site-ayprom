# Пагинация смешанных категорий через общий RPC

Дата: 2026-09-23
Ветка: `codex/claude-mixed-pagination`, исходный HEAD `02158a6`
Блокер: API-часть `mixed_category_pagination_api_missing`. Запись в route
manifest намеренно не снята: её снимает Codex после интеграционной проверки.

## Что изменилось

Прямые товары смешанной категории, то есть товары без подкатегории, теперь
пагинируются тем же контрактом, что поиск: count и страница считаются в SQL, а
Worker и legacy adapter возвращают один и тот же `ProductPage`.

| Слой | Контракт |
|---|---|
| Публичный URL Worker | `GET /api/catalog/search?category=<slug>&noSubcategory=1&page=N` |
| `ProductFilters` | `withoutSubcategory?: boolean` |
| RPC `search_catalog_products` | новый последний аргумент `require_no_subcategory boolean DEFAULT false` |
| Тело POST RPC | ключ `require_no_subcategory: true` передаётся **только** во включённом режиме; обычные запросы отправляют ровно прежние пять ключей |
| Legacy adapter | `getProductsWithoutSubcategory(categorySlug, page, pageSize)` вызывает `getProducts({ categorySlug, withoutSubcategory: true, page, pageSize })` |
| Legacy fallback (RPC без нового аргумента) | `getLegacyProductPage` добавляет `.is("subcategory_id", null)`; Sentry получает `extra.requireNoSubcategory = true` |

`subcategory=none` не используется как признак режима: это обычный slug.
Изолированный контракт отдельно проверил подкатегорию со slug `none`.

### Политика конфликтов

Выборка никогда молча не расширяется.

- `subcategory=<slug>` вместе с `noSubcategory=1`: `CatalogSearchFilterError`
  (`conflicting_subcategory_filters`). Worker отвечает
  `400 invalid_catalog_search`, Supabase не вызывается, `reportError` не
  срабатывает. Legacy `getProducts` бросает ошибку до обращения к Supabase.
- `noSubcategory` с любым значением, кроме `1` (`true`, `0`, пусто,
  ` 1`): `invalid_no_subcategory`, тоже `400`.
- Пустой `subcategory=` рядом с `noSubcategory=1` игнорируется, как и прежде
  любые пустые фильтры.
- На уровне SQL `subcategory_filter` вместе с `require_no_subcategory = true`
  даёт пустую выборку. `require_no_subcategory = NULL` трактуется как
  выключенный фильтр, как у остальных аргументов.

### Что сохранено без изменений

- Raw PostgREST `POST ?offset=&limit=` без `Range`.
- Пустая страница за пределами результата: `416 Content-Range: */N` → `ProductPage` с `total = N`.
- Нормализация некорректной страницы (`0`, `-4`, `1.5`, `MAX_SAFE_INTEGER` → 1) и лимит `pageSize ≤ 48`.
- Сортировка обычного поиска (`order, name`).
- RLS, `published = true`, `SECURITY INVOKER`, `SET search_path TO ''`, гранты `anon`/`authenticated`/`service_role`.

Поведение `getProductsWithoutSubcategory` уточнилось в двух местах:

1. При равном `order` сортировка теперь идёт `order, name`, а не только `order`.
2. Дробная страница нормализуется. Прежде `page = 1.5` давала смещение 12.

## Миграция и декларативная схема

Миграция `supabase/migrations/20260923053402_mixed_category_no_subcategory_search.sql`
сгенерирована штатным `supabase db diff -f mixed_category_no_subcategory_search`
(pg-delta, `schema_paths = ./schemas/*.sql`). Генератор работает во временной
shadow-БД и ничего не применяет к локальной или удалённой базе. Команда
`supabase db schema declarative sync --no-apply` в этом проекте неприменима:
она ищет каталог `supabase/database`, а проект хранит схему в `supabase/schemas`.

Содержимое миграции: `DROP` старой пятиаргументной перегрузки, `CREATE` новой
шестиаргументной, `REVOKE ALL FROM PUBLIC`, `GRANT` для `anon`,
`authenticated`, `service_role`. Одна транзакция. Перегрузка остаётся одна,
поэтому PostgREST однозначно выбирает функцию и для пятиключевого, и для
шестиключевого вызова.

### Предсуществующий дрейф декларативной схемы

До этого изменения `db diff` не работал на `supabase/schemas`. Чтобы
получить чистую миграцию, исправлено следующее. Все правки только
синхронизируют файл с фактическим состоянием миграций, поведение БД они не
меняют.

| Дефект | Исправление |
|---|---|
| Нет `CREATE TYPE public.product_availability` (миграция 20260818224932) | тип добавлен |
| Семь admin-auth-функций с разделителем `$` вместо `$$` (с коммита `9224c5c`) | разделители восстановлены |
| `admin_credentials` объявлена дважды: `schemas/admin_credentials.sql` и `prod.sql` | удалён дубль `schemas/admin_credentials.sql`; `prod.sql` уже содержит таблицу, CHECK, PK, RLS и гранты (QA-014) |
| Каталожные таблицы без `REVOKE ALL` перед `GRANT SELECT` | добавлен `REVOKE ALL ... FROM anon, authenticated`; без него сгенерированная миграция **возвращала `anon` TRUNCATE/REFERENCES/TRIGGER/MAINTAIN** (откат QA-013) |
| Нет `GRANT` service_role на `record_admin_mutation` и пять `refresh_product_search_from_*` | добавлены, как в 20260827120000 |
| Тела `record_admin_mutation` и `register_admin_login_attempt` расходились с миграциями комментариями | тела совпадают с миграциями; пояснение про `current_time` вынесено над функцией |

Первая сгенерированная миграция содержала этот дрейф и была удалена без
применения. Итоговая содержит только изменение `search_catalog_products`.

## Проверки

| Команда / проверка | Результат |
|---|---|
| RED: `vitest` (contract, worker-api, direct-category) до реализации | exit 1, 30 failed / 29 passed |
| GREEN: те же файлы | 59/59 |
| `npm run check` (lint, typecheck, check:colors, весь vitest) | exit 0; 119 files passed, 1 skipped; 870 tests passed, 3 skipped |
| `supabase db diff -f …` (итоговый прогон) | exit 0, миграция только с `search_catalog_products` |
| pgTAP на изолированной **старой** схеме (SQL-RED) | FAIL: `catalog_no_subcategory` (21 план, упал на отсутствующей сигнатуре), `catalog_rls` test 2; остальные 11 файлов ok |
| pgTAP после миграции | PASS: 13 files, 232 tests |
| Реальный PostgREST, фаза `old` (новое приложение, старая схема) | 7/7 |
| Реальный PostgREST, фаза `new` (после `migration up` поверх данных) | 9/9 |
| `scripts/check-declarative-schema.mjs` против изолированной БД | согласовано, 156 объектов |
| Чистый старт изолированного стека со всеми миграциями, включая новую | exit 0 |
| `npm run build` без env | exit 1: `next.config.ts` требует `NEXT_PUBLIC_SUPABASE_URL` |
| `npm run build` с фиктивным loopback `:59999` | компиляция и TypeScript прошли; сбор данных страниц упал на `ECONNREFUSED` (ожидаемо) |
| `npm run build` против изолированного стека `127.0.0.1:55421` | exit 0; 36 статических страниц |
| `npx wrangler@4.135.0 deploy --dry-run --outdir <tmp> --config wrangler.jsonc --env-file <empty>` | exit 0; Total Upload 11.48 KiB / gzip 3.16 KiB |
| `node scripts/cloudflare/worker-smoke.mjs … --repeat 3` (настоящий workerd) | exit 0; bundle 11 753 bytes raw, 3 234 bytes gzip, 4 inputs; 25/25 ×3 (было 22, добавлены 3 кейса режима) |

Реальные PostgREST- и pgTAP-проверки выполнены на **одноразовом изолированном**
стеке `project_id = ayprom-nosub-isolated` (API `127.0.0.1:55421`, DB `:55422`),
поднятом из копии миграций в scratch-каталоге. Фикстуры: 30 прямых
опубликованных товаров, 1 неопубликованный, 3 товара с подкатегорией, включая
slug `none`. После проверок стек остановлен с `--no-backup`, его контейнеры и
тома удалены. Общий локальный стек `site-for-kirsan` не запускался, не
останавливался и не изменялся: его `search_catalog_products` осталась
пятиаргументной.

Изолированный стек поднимался без auth-сервиса, поэтому Kong принимал запросы
с произвольным публичным ключом под ролью `anon`. Роль подтверждена: прямой
запрос неопубликованного товара вернул `[]`. Проверку настоящего publishable
key это не заменяет: её покрывает штатный `npm run test:cloudflare:postgrest`.

## Не проверено

### Дополнительная независимая проверка Codex

После исходного checkpoint обнаружен и исправлен пропуск в legacy SDK-адаптере:
PostgREST возвращает `416/PGRST103` для страницы за пределами результата, а
`supabase-js` представляет её ошибкой и не отдаёт count из `Content-Range`.
Основной RPC-путь и fallback для старой схемы теперь повторно запрашивают
только первую строку с теми же фильтрами, восстанавливают exact count и
возвращают пустой `ProductPage` лишь когда смещение действительно за пределами
выборки. RED: два теста отвергали promise с `PGRST103`; GREEN: оба проходят,
один из них выполняет реальный `supabase-js` с локально подставленными HTTP
ответами старой схемы. Повторный `npm run check`: exit 0, 119 файлов passed,
1 skipped; 872 теста passed, 4 skipped. Предыдущий реальный PostgREST-прогон
не повторялся: одноразовый изолированный стек был остановлен и удалён.
Сборка после этой дополнительной правки также не повторялась.

- `npm run test:cloudflare:postgrest` на общем локальном стеке: новый кейс
  требует применить миграцию к общей БД. Это решение за интегратором.
- Рендер страницы `/catalog/category/<mixed>` в браузере: preview и Browser
  не запускались без разрешения. Страница по-прежнему вызывает
  `getProductsWithoutSubcategory`, её контракт покрыт unit- и
  изолированными PostgREST-тестами.
- Remote staging, Worker CPU, production-данные.

## Порядок rollout (schema-first)

1. Применить миграцию `20260923053402_mixed_category_no_subcategory_search` к
   базе, например `supabase db push` после review. Старое приложение
   продолжает работать: пятиаргументные вызовы разрешаются в новую функцию
   через `DEFAULT false`. На изолированном стеке проверено до и после.
2. Убедиться, что PostgREST перечитал schema cache: вызов с
   `require_no_subcategory` отвечает не `PGRST202`.
3. Выкатить приложение (Vercel) и Worker.
4. Только после этого Codex снимает `mixed_category_pagination_api_missing` в
   manifest.

Если нарушить порядок и выкатить приложение раньше схемы:

- Vercel продолжит работать через legacy fallback, фильтр сохраняется, но
  каждый рендер смешанной категории отправит в Sentry ошибку
  `search_catalog_products RPC missing` с `requireNoSubcategory: true`.
- Worker на запросы с `noSubcategory=1` вернёт `502`. Обычный поиск
  продолжит работать.

Откат: обратная миграция должна пересоздать пятиаргументную функцию и её
`GRANT`. Приложение с новым кодом на старой схеме работает через fallback,
как описано выше.
