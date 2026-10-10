# Аудит оставшихся каталожных маршрутов для Cloudflare static-build

Дата: 2026-09-24
Ветка: `codex/claude-mixed-pagination`, HEAD на момент аудита `118fa1174318df831158ccb2903d80ea8d91a80d`
Автор: Claude Sonnet 5
Код не менялся — это только анализ и план.

## Резюме

Из всех `"query"`-маршрутов (класс в `derivePublicRoutes`, требующий по спеке
клиентского адаптера `q`/`page` поверх замороженной страницы 1) два **не
подключены к static-build вообще**: `/catalog` и
`/catalog/vehicle-type/[slug]`. Ни один из них не содержит `STATIC_BUILD`-ветки,
`"use client"`-компонента или иного клиентского кода, который реально делал бы
запрос к `GET /api/catalog/search` после гидратации. Это подтверждённый дефект
(явно виден в исходниках), а не предположение.

Публичный API (`GET /api/catalog/search`) уже поддерживает оба сценария без
единого фильтра категории (`/catalog`) и с `vehicleType=<slug>` — новых RPC/SQL
изменений не требуется, в отличие от задачи со смешанной категорией.

Главное архитектурное отличие от уже подключённых страниц: обе страницы —
**сквозные** (cross-category) листинги. Каждый товар в выдаче может вести на
свою собственную каноническую страницу (`getProductHref`), а не на один общий
`basePath`. Текущий `ClientCatalogSearch` вычисляет ссылку на товар одной
строкой (`${productLinkBase}/${item.slug}`) и для этих двух страниц не
подходит без изменений.

## Метод

- Прочитаны исходники обеих страниц, `ProductGridWithSearch.tsx`,
  `ClientCatalogSearch.tsx`, `ClientMixedCategoryPagination.tsx`,
  `catalog-client-search.ts`, `catalog-search-contract.ts`,
  `product-href.ts`, `derive-routes.ts`.
- Проверено, какие тесты существуют для этих маршрутов (`grep` по `tests/`).
- Проверены реальные данные локального сида (`supabase/seed.sql`) на предмет
  multi-brand товаров и product↔vehicle-type связей.
- Ничего не запускалось (build/preview/browser), только чтение файлов и
  графа Graphify.

## Маршрут за маршрутом

### `/catalog` — семейство `catalog`, класс `query`

Файл: `src/app/(site)/catalog/page.tsx`.

- **Параметры запроса:** да, `q` и `page` читаются на сервере
  (`searchParams`), без фильтра по категории/бренду/подкатегории — это
  каталог целиком.
- **После заморозки одной статической страницы:** `page.tsx` не содержит ни
  `AYPROM_STATIC_BUILD`, ни `"use client"`-импорта. HTML замораживается на
  той выдаче, что вернул краулер (обычно страница 1 без `q`). Cloudflare
  Static Assets резолвит путь без учёта query string, поэтому переход по
  `/catalog?page=2` или отправка формы (`GET /catalog?q=...`) физически
  откроет **тот же самый замороженный файл** — тот же список товаров,
  molча проигнорировав и `page`, и `q`. Это не «страница не найдена», а тихая
  no-op, что хуже: выглядит как рабочий, но неверный результат.
- **Клиентский обработчик:** отсутствует. `ProductGridWithSearch` и
  `CatalogPagination` — обычные Server Components без `"use client"`, рендерят
  `next/link` `<Link>` на сервере; на клиенте нет кода, который перехватывал
  бы клик/submit и звал `fetch`.
- **Ссылки на товары, включая multi-brand:** `href={(product) =>
  getProductHref(product, categoryBrandSlugs, directProductCategorySlugs)}` —
  функция, вычисляемая на сервере один раз для каждого товара. Логика
  `getProductHref`: сначала подкатегория, затем первый бренд из
  `compatibleBrands`, входящий в `categoryBrandSlugs[category]`, затем прямая
  категория, иначе `/catalog` как безопасный fallback. Для multi-brand товара
  (напр. `man`+`daf` в сиде) сервер сегодня стабильно выбирает **первый**
  подходящий бренд по порядку `categoryBrandSlugs[category]`, не по порядку
  `compatibleBrands` товара — деталь, которую клиентская реализация обязана
  воспроизвести один в один, иначе для одного и того же товара на карточке в
  `/catalog` и на его собственной странице появятся два разных «канонических»
  URL.
- **Что нужно для проверки:** нет отдельного page-level теста ни в normal,
  ни в static-режиме (в `tests/` нет `catalog-page*.test.tsx`); есть только
  `sitemap-route-parity.test.ts` и `cloudflare-static-build-derive-routes.test.ts`
  на уровне манифеста маршрутов, они не рендерят страницу и не видят этот
  дефект. Локальный сид пригоден: multi-brand товары есть (`product_brands`
  содержит несколько строк на один `product_id`), значит юнит/компонентный
  тест на выбор бренда воспроизводим без правки данных.

### `/catalog/vehicle-type/[slug]` — семейство `vehicle-type`, класс `query`

Файл: `src/app/(site)/catalog/vehicle-type/[slug]/page.tsx`.

- **Параметры запроса:** да, `q`/`page` через `searchParams`, плюс
  `vehicleTypeSlug` из сегмента маршрута (`params.slug`) как фильтр
  `getProducts({ vehicleTypeSlug: slug, query: q, page })`.
- **После заморозки:** то же самое, что у `/catalog` — ни одна ветка кода не
  проверяет `AYPROM_STATIC_BUILD`, HTML статичен на всегда одну и ту же
  выдачу, `q`/`page` в адресной строке после заморозки ни на что не влияют.
- **Клиентский обработчик:** отсутствует, ровно как выше — та же пара
  `ProductSearchForm`/`ProductGridWithSearch`, без каких-либо client-side
  добавлений.
- **Ссылки на товары:** идентично `/catalog` — `getProductHref` с теми же
  двумя lookup-таблицами; страница кросс-категорийная (товары разных типов
  техники могут быть в разных категориях), поэтому строкового `basePath`
  тоже недостаточно.
- **Что нужно для проверки:** `product_vehicle_types` в `supabase/seed.sql`
  **пуст** (таблица объявлена, но ни одной строки INSERT нет — проверено
  напрямую в файле сида). Значит на текущем локальном стенде эта страница для
  любого `vehicleTypeSlug` вернёт `productPage.items = []` независимо от
  реализации — реальная (не мок) HTTP-проверка непустой выдачи, пагинации на
  странице ≥2 и multi-brand ссылки на этом маршруте невозможна без
  предварительного добавления хотя бы нескольких строк в
  `product_vehicle_types` для локального стенда. Это ограничение окружения,
  а не архитектурная проблема — сама схема и `vehicle_types` (5 строк) на
  месте.

## Проверенные соседние маршруты — уже покрыты или не требуют работы

Чтобы не пропустить ложный «остаток», проверены все семейства с классом
`"query"`/`"static"` из `derivePublicRoutes`:

| Семейство | Класс | Статус |
|---|---|---|
| `category` (`type: null`) | query | подключено (Task 4) |
| `category` (`type: "subcategory"`, смешанная) | query | подключено (Task 5, включая пагинацию прямых товаров) |
| `category` (`type: "brand"`) | static | не читает `searchParams` вообще — подключать нечего |
| `subcategory` | query | подключено (Task 1/2) |
| `category-brand` | query | подключено (Task 3) |
| `brand-category-subcategory` | query | подключено (Task 3) |
| `brand` (`/catalog/brand/[slug]`) | static | проверено исходники — не читает `searchParams`, только карточки категорий; подключать нечего |
| `brand-category` (`/catalog/brand/[slug]/category/[categorySlug]`) | static | то же самое — только список подкатегорий, без `q`/`page` |
| `catalog` | query | **не подключено** (этот отчёт) |
| `vehicle-type` | query | **не подключено** (этот отчёт) |

Таким образом `/catalog` и `/catalog/vehicle-type/[slug]` — это весь
оставшийся объём работы по клиентскому поиску/пагинации; других пропусков в
классе `"query"` нет.

Также замечено (не в рамках этой задачи, только фиксирую): раздел
«Search and pagination» в
`docs/superpowers/specs/2026-09-21-ayprom-crawl-and-freeze-design.md` (строки
195–197) всё ещё утверждает, что смешанная категория «is not declared
complete until its pagination has an equivalent public API contract» — этот
текст устарел после коммитов `88d0695` и `90191d7`/`118fa11` в этой же ветке.
Не редактировал спецификацию — это отдельное решение интегратора.

## Почему нельзя просто переиспользовать `ClientCatalogSearch` как есть

`ClientCatalogSearch` строит ссылку на товар одной строкой:
`href={`${productLinkBase}/${item.slug}`}` (`productLinkBase = productBasePath
?? basePath`). Это верно для всех уже подключённых страниц, потому что там
каждый товар в выдаче гарантированно живёт под одним и тем же префиксом URL
(категория, подкатегория, бренд×категория и т.д.). `/catalog` и
`/catalog/vehicle-type/[slug]` — исключение: их выдача объединяет товары из
любых категорий/подкатегорий/брендов, и у каждого товара свой собственный
канонический URL, определяемый чистой функцией `getProductHref`.

Важно: `getProductHref` (в `src/lib/product-href.ts`) — чистая функция без
серверных зависимостей (импортирует только тип `ProductListItem`), уже
идентична как для `/catalog`, так и для `/catalog/vehicle-type/[slug]`.
Её можно импортировать прямо в `"use client"`-компонент без дублирования
логики. Единственное, чего не хватает клиенту, — те же самые данные, что
сервер получает через `getCategoryBrandSlugs()`
(`Record<string, string[]>`, уже сериализуемо) и
`getDirectProductCategorySlugs()` (**`Set<string>`** — при передаче как
пропа в Client Component нужно сначала превратить в массив, `Set` не
следует передавать через границу RSC как проп напрямую, в отличие от
обычных объектов/массивов).

Передавать сам `getProductHref` как функцию через границу Server→Client
**нельзя** — это тот самый подтверждённый в Task 1 баг (`Functions cannot be
passed directly to Client Components`). План ниже передаёт только данные.

## План следующего небольшого изменения

Предлагаю один слайс на обе страницы вместе (`/catalog` и
`/catalog/vehicle-type/[slug]`), поскольку они делят один и тот же пробел и
одно и то же решение — разносить на два отдельных PR смысла нет, но при
желании интегратора можно расщепить на этапе реализации.

### 1. Расширить `ClientCatalogSearch` вторым режимом ссылки на товар

Файл: `src/components/catalog/ClientCatalogSearch.tsx`.

Добавить необязательные пропы:

```ts
categoryBrandSlugs?: Record<string, string[]>;
directProductCategorySlugs?: string[]; // не Set — сериализуемо через RSC
```

Внутри компонента:

```ts
const productHref = categoryBrandSlugs && directProductCategorySlugs
  ? (item: ProductListItem) =>
      getProductHref(item, categoryBrandSlugs, new Set(directProductCategorySlugs))
  : (item: ProductListItem) => `${productLinkBase}/${item.slug}`;
```

и заменить `href={`${productLinkBase}/${item.slug}`}` на `href={productHref(item)}`.

Почему расширять существующий компонент, а не копировать его (как это было
осознанно сделано для `ClientMixedCategoryPagination`): там разошлась сама
*разметка* (грид со смешанными карточками категорий/товаров, отсутствие
поля поиска). Здесь разметка и вся логика поиска/пагинации/ошибок/гонок —
идентичны существующему `ClientCatalogSearch`; расходится только формула
одной строки — вычисление `href`. Это тот случай, где повторное
использование безопаснее копирования: два места, вычисляющие
`getProductHref`-подобную логику по-разному, рано или поздно разойдутся.

`getProductHref` уже существует и протестирован отдельно — новых сценариев
внутри самой функции придумывать не нужно, только прокинуть данные.

### 2. Server Component-обёртки для двух страниц

Изменить `src/app/(site)/catalog/page.tsx` и
`src/app/(site)/catalog/vehicle-type/[slug]/page.tsx` по образцу уже
принятого паттерна (`STATIC_BUILD` через `process.env.AYPROM_STATIC_BUILD ===
"1"`, замораживать выдачу без `q`/на странице 1 через `STATIC_BUILD ? 1 :
page` и `STATIC_BUILD ? undefined : q`, ветвление
`STATIC_BUILD ? <ClientCatalogSearch .../> : <ProductGridWithSearch .../>`
внутри `ProductSearchForm`/шелла).

Для `/catalog/vehicle-type/[slug]` дополнительно передать
`vehicleTypeSlug={slug}` в `ClientCatalogSearch` — это уже поддерживаемый
проп (`CatalogClientSearchFilters.vehicleTypeSlug`), нового поля не нужно.

`directProductCategorySlugs` конвертировать в массив непосредственно перед
передачей в клиентский компонент: `[...directProductCategorySlugs]`.

### 3. Тесты (TDD, по образцу уже существующих файлов)

- `tests/catalog-client-search.test.ts` — новый чистый тест на
  `buildCatalogSearchApiUrl` без единого фильтра (только `q`/`page`, случай
  `/catalog`) и с `vehicleTypeSlug` — оба случая уже поддержаны кодом, но
  никогда явно не проверялись; тест должен пройти сразу (это фиксация
  контракта, не новая логика).
- `tests/client-catalog-search.test.tsx` — новые тесты монтирования
  `ClientCatalogSearch` с `categoryBrandSlugs`/`directProductCategorySlugs`:
  ссылка на multi-brand товар выбирает тот же бренд, что и
  `getProductHref` напрямую; товар без бренда/подкатегории и вне
  `directProductCategorySlugs` ведёт на `/catalog` (безопасный fallback);
  без этих двух пропов старое поведение (`productLinkBase`) не ломается —
  регрессионный тест на уже подключённые страницы.
- Новый `tests/catalog-page-static-build.test.tsx` (по образцу
  `category-page-static-build.test.tsx`, вызов `CatalogPage(...)` напрямую с
  замоканными `@/lib/queries/*`): freeze-страницы-1 независимо от
  `page`/`q` запроса при сборке, нормальный режим передаёт `q`/`page` как
  раньше без изменений — до сих пор ни одного теста на эту страницу не
  было вообще, значит этот файл — не расширение покрытия, а его появление.
- Новый `tests/vehicle-type-page-static-build.test.tsx` — то же самое плюс
  проверка, что `vehicleTypeSlug` реально доходит до
  `buildCatalogSearchApiUrl` (`?vehicleType=<slug>`), и что `notFound()` для
  отсутствующего `vehicleType` не задет STATIC_BUILD-веткой.

### 4. Данные/зависимости

- **Не зависит от producer Cursor.** Всё изменение — Server/Client
  Component + чистый модуль + тесты внутри Next-приложения;
  `derivePublicRoutes` уже классифицирует оба маршрута как `"query"` и уже
  включает их в манифест/sitemap безусловно (проверено в исходниках) —
  менять классификацию не требуется, только фактическое поведение страницы
  за этой классификацией.
- **Не требует изменений SQL/RPC/Worker.** `GET /api/catalog/search` и
  `search_catalog_products` уже принимают «без фильтра категории» и
  `vehicleType` — тот же контракт, что использует `getProducts` на сервере
  сегодня; путь данных общий (`executeCatalogSearch`/`createCatalogSearchRequest`
  для обеих сторон), поэтому страница 1, замороженная сервером, и
  дозагруженные клиентом страницы гарантированно совпадают по формату.
- **Нужен доп. набор данных только для реальной HTTP-проверки
  `/catalog/vehicle-type/[slug]`**: заполнить `product_vehicle_types` для
  локального сида (хотя бы по 1–2 товара на 1–2 типа техники), иначе
  проверяемо только через моки/юнит-тесты, а не вживую. Для `/catalog`
  локальные данные уже достаточны (multi-brand товары есть).
- Ничего не требует запуска/остановки общего Supabase — работа целиком на
  уровне кода и юнит/компонентных тестов; реальный build/HTTP-смоук (как в
  предыдущих задачах) можно провести отдельным шагом с разрешения, на уже
  поднятом стенде, только для `/catalog` (данные для vehicle-type сначала
  нужно досеять).

## Что дальше рекомендую

Один PR/чекпоинт на оба маршрута сразу — общий код (шаг 1) один и тот же,
разделять его между двумя мелкими PR добавило бы риск, что первый смёржится
без второго и `ClientCatalogSearch` временно останется с неиспользуемыми
пропами. Оценка объёма: 1 изменение в общем компоненте + 2 страницы + 4
файла тестов — сопоставимо по размеру с уже сделанными Task 3/Task 4.
