# Cursor: детерминированный основной URL товара (getProductHref)

- Дата: 2026-09-23
- Ветка: `codex/cursor-canonical`, исходный HEAD `02158a64cf62d86a9953394848351ab3b1f9440b`
- Рабочая копия: `C:\Users\user\.codex\worktrees\ayprom-cursor-canonical\site-for-kirsan`
- Статус: локальный кандидат на интеграцию. Без push, merge, deploy и production-изменений.

## Проблема

`getProductHref` выбирал бренд для основного URL через `compatibleBrands.find(...)`, то есть брал первый
совместимый бренд в том порядке, в котором его вернул источник данных. Один товар с несколькими
разрешёнными брендами категории получал разные «основные» ссылки в зависимости от порядка строк
Supabase, static snapshot или API. От этого зависят sitemap, redirect `/product/<slug>` (308),
ссылки в листингах (`/catalog`, `/catalog/vehicle-type/*`) и связанные товары в `ProductDetail`.

## Правило после изменения

Среди пересечения `compatibleBrands` и разрешённых брендов категории выбирается наименьший slug
по обычному сравнению строк `<` (UTF-16 code units; для ASCII-slug это код-пойнт порядок).
`localeCompare`/`Intl.Collator` сознательно не используется: их результат зависит от ICU-данных
и локали среды выполнения. Дубликаты не влияют на результат. Входные массивы и объекты не
мутируются (ничего не сортируется на месте). Приоритет сохранён:
subcategory > matching brand > direct category > `/catalog`.

## Поведение до/после на multi-brand примере

Товар `shaft`, категория `pto` (type = brand), `compatibleBrands = ["shacman", "kamaz"]`,
`category_brands.pto = ["shacman", "kamaz"]`.

| Место | До (зависит от порядка) | После (стабильно) |
|---|---|---|
| `getProductHref` | `/catalog/category/pto/brand/shacman/shaft` | `/catalog/category/pto/brand/kamaz/shaft` |
| sitemap (`derivePublicRoutes`, `src/app/sitemap.ts`) | один URL, `.../brand/shacman/shaft` | один URL, `.../brand/kamaz/shaft` |
| redirect `/product/shaft` (308) | `.../brand/shacman/shaft` | `.../brand/kamaz/shaft` |
| Static manifest `product` entries | оба brand URL | оба brand URL, без изменений |

При обратном порядке данных (`["kamaz", "shacman"]`) старое правило давало `kamaz`, новое — тоже
`kamaz`. Для товаров с одним совместимым брендом, с подкатегорией и для «прямых» категорий
результат не меняется.

Честное предупреждение: для multi-brand товаров, у которых прежде первым в данных шёл не
лексикографически меньший бренд, sitemap-URL и цель redirect изменятся относительно текущего
(зависимого от порядка) результата. Это стабилизация выбора, а не пересмотр SEO-политики.
Варианты URL не удалялись, redirect не добавлялись, metadata/self-canonical страниц не трогались.
Реестр BASE-07 (7 товаров без пересечения с `category_brands`) этим изменением не затрагивается:
ветка fallback `/catalog` осталась прежней.

## Файлы

- `src/lib/product-href.ts` — `find` заменён на `pickPrimaryBrandSlug` (минимум пересечения).
- `tests/product-href.test.ts` — 9 новых тестов: все перестановки `compatibleBrands` (4!) ×
  перестановки разрешённых брендов (3!), лексикографический минимум, независимость от локали
  (`"B-brand" < "a-brand"` по code units), дубликаты, бренды вне пересечения, приоритет
  подкатегории, пустое пересечение → direct/`/catalog`, пустые пограничные данные,
  отсутствие мутаций (frozen inputs).
- `tests/product-href-brand-order-parity.test.ts` — новый parity-тест: `derivePublicRoutes`
  на «неудобном» и естественном порядке брендов даёт одинаковый canonical, alias-redirect,
  sitemap-путь и байт-идентичный `serializeRouteManifest`; все brand URL остаются в manifest;
  legacy sitemap-адаптер (`src/app/sitemap.ts`) с моками Supabase-запросов в обратном порядке
  публикует один стабильный URL.
- `docs/superpowers/reports/2026-09-23-cursor-canonical-product-href.md` — этот отчёт.

Чужие файлы (`src/lib/queries/products.ts`, `catalog-search-contract.ts`, Worker, SQL/migrations,
`static-build/derive-routes.ts`, static producer, metadata страниц, `package.json`/lock) не менялись.
Предлагаемых diff в чужие участки нет: исправление полностью укладывается в `getProductHref`.

## TDD: RED → GREEN

RED (до правки `src/lib/product-href.ts`):

```
npx vitest run tests/product-href.test.ts tests/product-href-brand-order-parity.test.ts --maxWorkers=2
Test Files  2 failed (2)   Tests  8 failed | 11 passed (19)   exit 1
```

Упали: перестановки; лексикографический минимум; независимость от локали; дубликаты;
отсутствие мутаций (ожидался `daf`, получен `shacman`); derive-routes canonical/redirect/sitemap;
байт-идентичный manifest; sitemap-адаптер.

GREEN (после правки):

```
npx vitest run tests/product-href.test.ts tests/product-href-brand-order-parity.test.ts --maxWorkers=2
Test Files  2 passed (2)   Tests  19 passed (19)   exit 0
```

## Приёмка: команды и коды выхода

| Команда | Результат | Exit |
|---|---|---|
| `npm run test:cloudflare:static-contracts -- --maxWorkers=2` | 7 файлов, 132 теста passed | 0 |
| `npm run lint` | без ошибок | 0 |
| `npm run typecheck` | без ошибок | 0 |
| `npm run check:colors` | прямых цветов не найдено (266 файлов) | 0 |
| `npm test -- --maxWorkers=2` | 120 файлов passed, 1 skipped; 851 тест passed, 3 skipped; 51 с; таймаутов не было | 0 |
| `npm run check` | одной командой не запускался: по заданию Vitest ограничен `--maxWorkers=2` из-за параллельной работы worktrees; все четыре его шага выполнены отдельно (выше) | — |
| `npm run build` | **не выполнен**: в worktree нет `.env.local`; `next build` падает при загрузке `next.config.ts` (`TypeError: Invalid URL`, `input: 'undefined'`). Production env не подключался. Изменение не касается Next-конфигурации и runtime-кода страниц; покрыто typecheck, lint и полным vitest | 1 (env) |
| `graphify update .` | 3123 nodes, 6504 edges, 245 communities; `graphify-out/` в `.gitignore` | 0 |
| `git diff --check` | чисто | 0 |

## Ограничения

- `npm run build` не подтверждён из-за отсутствия безопасной локальной конфигурации env.
- Rendered `<link rel=canonical>` трёх страниц товара по-прежнему self-canonical (задача не
  трогала metadata); parity рендера остаётся отдельным crawl-gate.
- Интеграцию в `main` выполняет Codex после review.

## Git

До коммита `git status --short --branch`:

```
## codex/cursor-canonical
 M src/lib/product-href.ts
 M tests/product-href.test.ts
?? tests/product-href-brand-order-parity.test.ts
?? docs/superpowers/reports/2026-09-23-cursor-canonical-product-href.md
```

Коммит содержит только эти четыре файла. Push/merge/deploy не выполнялись.
