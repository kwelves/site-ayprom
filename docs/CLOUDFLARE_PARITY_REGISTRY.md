# Реестр паритета AYPROM: Vercel → Cloudflare

Дата снимка: 2026-09-19  
Статус: Phase 0 baseline собран, Phase 1 compatibility spike выполнен локально
Production cutover: не выполнялся

## Назначение

Этот реестр определяет, что именно должно совпасть до переноса production-трафика с Vercel на Cloudflare. Пункт считается закрытым только при наличии воспроизводимого теста или сохранённого наблюдения. Успешная сборка сама по себе не подтверждает паритет.

Статусы:

- `PASS` — проверено в указанной среде и зафиксировано доказательство;
- `PARTIAL` — проверена только часть контракта;
- `BLOCKED` — обнаружено подтверждённое несовпадение или отсутствует обязательная инфраструктура;
- `TODO` — проверка ещё не выполнялась;
- `N/A` — пункт сознательно не относится к данному этапу.

## 1. Контрольная точка production

| ID | Контракт | Доказательство | Статус | Следующий gate |
|---|---|---|---|---|
| BASE-01 | Sitemap читается и содержит все канонические URL | `scripts/cloudflare-migration-baseline.mjs`: production `sitemap.xml` — HTTP 200, 130 URL | PASS | Повторить перед staging и cutover |
| BASE-02 | Все URL sitemap открываются | Production baseline: 130 из 130 URL — HTTP 200, конкурентность 4 | PASS | Сравнить с Cloudflare route manifest |
| BASE-03 | Canonical, title и H1 не теряются | Production baseline: 0 пропущенных canonical, 0 несовпадений canonical, 0 пропущенных title/H1 | PASS | HTML diff Vercel ↔ Cloudflare |
| BASE-04 | Description присутствует | Production baseline: 2 страницы без description | PARTIAL | Классифицировать как исходный дефект или исправить отдельно от миграции |
| BASE-05 | Доменные redirect сохраняются | `http`/apex/`www` цепочки заканчиваются на `https://www.ayprom-gidravlika.kg/` с HTTP 200 | PASS | Повторить на staging hostname и после route override |
| BASE-06 | Исходная Git-точка воспроизводима | Локальный checkpoint `12f4ef1`, ветка `main` была ahead 2 относительно `origin/main` | PASS | Перед integration повторно проверить HEAD и working tree |
| BASE-07 | Каждый опубликованный товар имеет canonical URL | Из 87 товаров canonical строится для 80; 7 товаров категории `brand` не пересекаются с `category_brands` и исключены из sitemap | BLOCKED | Исправить данные или правило маршрутизации отдельным контролируемым изменением |
| BASE-08 | Отсутствующие сущности возвращают настоящий 404 | Неизвестные товар/категория отвечают HTTP 200 с `noindex`; полностью неизвестный путь отвечает 404 | BLOCKED | До cutover решить, исправляем исходный дефект или временно сохраняем его как baseline |

Полный JSON baseline находится вне репозитория: `C:\Users\user\AppData\Local\Temp\ayprom-cloudflare-baseline.json`.

## 2. Публичная часть

| ID | Контракт | Текущее покрытие | Результат Cloudflare spike | Статус |
|---|---|---|---|---|
| PUB-01 | Главная страница, SSR-текст, hero и секции | `tests/e2e/public/public-smoke.spec.ts`, `home-seo`, hero и showcase tests | Локальный workerd: `/` — 200, корректный title | PARTIAL |
| PUB-02 | Каталог, поиск и пагинация сохраняют `q`/`page` | `public-smoke`, product/card/query tests | `/catalog`, `/catalog?q=насос`, `/catalog?page=2` — 200 | PARTIAL |
| PUB-03 | Категории, подкатегории, бренды и типы техники | routing, mixed-grid, brand/category/vehicle SEO tests | Vinext классифицировал динамические/ISR-маршруты; выборочная категория — 200 | PARTIAL |
| PUB-04 | Карточка товара, галерея, fallback и metadata | `product-metadata.spec.ts`, gallery/carousel/image fallback tests | Выборочная товарная карточка — 200 и корректный title | PARTIAL |
| PUB-05 | «О компании» и «Контакты» | public smoke/navigation | `/about` и `/contacts` — 200 | PARTIAL |
| PUB-06 | Неизвестный URL возвращает 404 | `global-not-found.spec.ts` | `/definitely-missing-page` — 404 | PASS |
| PUB-07 | `robots.txt` и `sitemap.xml` сохраняются | production baseline | workerd: оба 200; sitemap содержит 130 `<loc>` | PASS |
| PUB-08 | Canonical и OpenGraph используют production origin | metadata tests | В локальном spike canonical указывает `localhost:3001` из локального env | TODO |
| PUB-09 | Визуальный паритет desktop/mobile | responsive и QA Playwright | Браузерное сравнение vinext-сборки не выполнялось | TODO |
| PUB-10 | Accessibility, focus, Escape и mobile navigation | `accessibility-navigation.spec.ts` | Локальный workerd + Chromium с мобильным viewport/touch: меню и подраздел открываются с клавиатуры; Escape закрывает их поэтапно и возвращает видимый фокус. Полный аудит доступности и удалённый Cloudflare не проверены | PARTIAL |
| PUB-11 | Hero-видео startup → quality, range HTTP 206 | hero tests | На Cloudflare runtime не выполнялось | TODO |
| PUB-12 | R2 media, variant 404 → master fallback | media/image tests | Изолированный Chromium через Playwright: вариант 404 → локальный master 200 и два 404 → доступная заглушка; настоящий `ImageFallback`, но `next/image` заменён тестовой `<img>`-границей. Это не полный static-page/R2 gate; отчёт `docs/superpowers/reports/2026-10-03-public-image-fallback-browser.md` | PARTIAL |

`PARTIAL` означает, что HTTP-ответ получен, но ещё не доказаны DOM, hydration, console, network, responsive и visual contracts.

## 3. Админка и авторизация

| ID | Контракт | Текущее покрытие | Результат Cloudflare spike | Статус |
|---|---|---|---|---|
| ADM-01 | Неавторизованный `/admin` перенаправляет на login | admin login/baseline E2E | Отдельный локальный thin-Worker auth-fixture: гость получает 302 на `/admin/login`, прямой `/admin/index.html` — 404. Прежний диагностический пакет `fresh-20260927-a8afa5c8` не менялся и по-прежнему не включает админку | PARTIAL |
| ADM-02 | Login page открывается | `admin-login.spec.ts` | Отдельный локальный auth-fixture: `/admin/login` — 200 с `no-store`; браузер без JavaScript выполнил вход/выход. Это не страница production-админки и не часть готового пакета | PARTIAL |
| ADM-03 | Valid/invalid login, rate limit и session refresh | auth/session/rate-limit tests | Отдельный Supabase + workerd: правильный/неверный пароль, атомарные параллельные брони 3/4 и идемпотентное завершение, истечение и отзыв сессии по версии прошли. Финальный час refresh проверен unit-тестом, не в браузере. Production по-прежнему использует `ADMIN_PASSWORD`, без переключения | PARTIAL |
| ADM-04 | Password change и инвалидирование сессий | password/session tests | Локальный Worker уже проверяет сессию, Origin и текущий пароль; PBKDF2 выполняет отдельная Supabase Edge Function, CAS-запись повышает версию и отзывает старые cookie. Изолированный packaged workerd + Edge Runtime + браузер без JS прошли 21/21; production/remote staging, audit и полный admin parity не проверены | PARTIAL |
| ADM-05 | Product CRUD, conflict, publish и bulk actions | admin product E2E и unit tests | CRUD не переносился. Отдельно проверен локальный защищённый read-only список: 50 строк/страница, поиск, черновики только после проверки сессии, отказ при ошибках и запрет mutations. Packaged workerd + собственная Supabase + Chromium без JS: 17/17 проверок. Это не подтверждает create/edit/delete/publish/bulk; отчёт `2026-09-30-cloudflare-admin-readonly-products.md`. 2026-10-04: локально доказано только **редактирование одного товара** — приватное чтение с точным `updated_at`, защищённый `GET /api/admin/products/:slug` и форма без JS с CAS-конфликтом 409. Изолированная Supabase/PostgREST + workerd: 12/12. В `worker.ts` подключено только чтение; запись есть лишь в тестовой композиции до появления обновления статических страниц. Create/delete/publish/bulk/фото не переносились; отчёт `2026-10-04-cloudflare-admin-product-edit.md` | PARTIAL |
| ADM-06 | Category/subcategory/brand/vehicle CRUD и reorder | admin tests | Не запускалось | TODO |
| ADM-07 | Vehicle showcase save/undo/CAS | showcase tests | Не запускалось | TODO |
| ADM-08 | Import preview/commit/partial errors | import tests | Не запускалось | TODO |
| ADM-09 | Audit entry на каждую mutation | audit tests | Не запускалось | TODO |
| ADM-10 | Server-side SVG validation | `src/lib/admin/upload-validation.ts`, upload-validation tests | Node `vinext start` падает на отсутствующем `xhr-sync-worker.js` из `jsdom`; workerd login не вызывает эту ветку | BLOCKED |
| ADM-11 | Четыре режима обработки фото дают прежний результат | image/enhance/staging/E2E tests | Сгенерированный vinext-конфиг заменяет `sharp` stub-функцией, которая всегда бросает ошибку | BLOCKED |
| ADM-12 | Progress/retry/cancel/partial failure | staged upload E2E | Не запускалось | TODO |
| ADM-13 | Cookie, CSRF/origin, CSP и security headers | session/CSP tests | Локальный preview: cookie gate, no-store, Origin/CSRF отказ, tamper/expiry/version отказ, CSP и browser navigation прошли. Auth/RPC/version HTTP bounded до 64 KiB и 10 s на вызов; настоящий workerd отказал на redirects/oversized/stalled ответах, не выдав cookie и не обратившись к redirect sink. Отчёт `2026-09-30-cloudflare-admin-http-boundaries.md`; безопасность реальных admin mutations не проверялась | PARTIAL |

Запрещено подтверждать ADM-03–ADM-09 на production-данных. Для них нужен отдельный test Supabase и test R2.

Локальный дополнительный gate ADM-01 (2026-09-30): настоящий workerd со статической fixture-оболочкой не отдал скрытый HTML без сессии через `/admin/index.html`, варианты регистра/кодировки/двойных слешей, HEAD или POST. Тест проверяет отсутствие маркера в теле, а не только HTTP-код. Это не подтверждает правила удалённого Cloudflare; подробности в `docs/superpowers/reports/2026-09-30-cursor-admin-route-boundary.md`.

CPU gate ADM-03/04 (2026-09-30): локальные медианы wall time PBKDF2-600000 в двух прогонах — 338–506 мс для проверки и 455–591 мс для создания hash (по 6 измерений после прогрева). Официальный предел Workers Free — 10 мс **CPU**, поэтому это высокий риск, но локальная длительность не доказывает удалённый `exceededCpu`. Без отдельного remote staging не повышать ADM-03/04 до PASS и не снижать стоимость хеша ради лимита. Отчёт `docs/superpowers/reports/2026-09-30-cloudflare-worker-free-auth-cpu-risk.md`.

Результаты full-vinext spike не подтверждают выбранную архитектуру Static Assets + thin Worker. Прежний диагностический пакет проверен только для публичного сайта и поиска; `ready: true` в его manifest означает локальную целостность пакета, а не готовность админки или production-релиза. Отдельный auth-fixture и его границы описаны в `docs/superpowers/reports/2026-09-28-cloudflare-local-admin-auth.md`. Обновление 2026-09-30: тестовая оболочка объединена с настоящими публичными страницами в отдельном **локальном admin-preview** пакете (`ready: false`, `previewReady: true`, `productionReady: false`). Изолированный Supabase + workerd прошли 15/15 проверок, включая вход/выход в браузере без JavaScript и отказ без admin bindings; публичный поиск и alias 308 проверены отдельно. Это уточняет старые fixture-only результаты ADM-01/02/03/13, но не закрывает их production parity и не переносит CRUD. Подробности: `docs/superpowers/reports/2026-09-30-cloudflare-admin-preview-package.md`. История пробела: `docs/superpowers/reports/2026-09-27-cloudflare-admin-package-gap.md`.

Дополнение 2026-09-30 (review результата Claude): неподключённый adapter нынешней схемы `ADMIN_PASSWORD`/PBKDF2 принят в integration как `c1e56c8`. Codex независимо проверил 30 unit cases + 1 настоящий локальный workerd test, общий check — 1277 passed / 4 skipped, static-build — 36/36. Неверный hash/сбой state не открывают env fallback; криптография и 600000 итераций сохранены. Это НЕ переключение preview: пакет пока по-прежнему использует тестовый Supabase Auth verifier. Read-only reader credential row, защита от смены версии во время login и remote CPU gate остаются незакрытыми. Отчёт приёмки: `docs/superpowers/reports/2026-09-30-cloudflare-agent-review.md`.

Дополнение ADM-05 от 2026-10-04: тестовая форма редактирования прошла настоящий
Chromium без JavaScript на отдельной Supabase и двух локальных Worker: вход,
сохранение (303), проверка записи в БД и отказ устаревшей вкладке (409), всего
13/13 проверок с очисткой временного стека. Это усиливает локальное доказательство
формы, но рабочий `worker.ts` остаётся read-only, поэтому статус ADM-05 — PARTIAL.

## 4. Worker и Static Assets

| ID | Метрика/контракт | Измерение spike | Статус | Gate |
|---|---|---|---|---|
| WRK-01 | `vinext check` | 87%: 22 supported, 3 partial, 2 issues; результат загрязнён временными release-копиями | PARTIAL | Повторить на чистом tracked snapshot |
| WRK-02 | Сборка vinext | Успешна только после React `19.3.0`, ручного ESM-исправления и создания отсутствующего Sharp stub | BLOCKED | Сборка должна проходить без ручных патчей |
| WRK-03 | Worker bundle укладывается в лимит | Full-vinext spike: upload 6148.23 KiB, gzip 1576.79 KiB; thin API asset-first prototype: 10 085 bytes raw, 2871 bytes gzip, 4 inputs | PASS | Повторять на каждом архитектурном milestone |
| WRK-04 | Static asset count укладывается в лимит | Full-vinext spike: 180 assets и около 9.67 MB; отдельный asset-first fixture: 7 файлов, 2262 bytes, максимум 485 bytes; gate отклоняет >20 000 файлов и >25 MiB на файл | PARTIAL | Повторить gate на реальном production static build |
| WRK-05 | Build time воспроизводим | Пять стадий vinext заняли примерно 39 секунд после установки зависимостей | PASS | Отдельно измерить Workers Build end-to-end |
| WRK-06 | Worker Free CPU ≤ 10 ms, p95 ≤ 7 ms | Локальный workerd не применяет Free CPU limit; тяжёлый PBKDF2 теперь вынесен в отдельную Supabase Edge Function, но CPU самого тонкого Worker и лимиты Edge Function удалённо не измерены | TODO | Измерить на изолированном remote staging без production traffic |
| WRK-07 | Asset-first routing не расходует Worker quota | Локальный Wrangler/workerd proof обслуживает `/`, `/catalog`, `/admin`, CSS и HTML 404 через Static Assets, сохраняя canonical URL без trailing slash; конфликтующий `/api/health/index.html` проигрывает Worker благодаря `run_worker_first: ["/api/*"]`; 28/28 checks | PARTIAL | Подтвердить invocation/billing semantics на isolated remote staging |
| WRK-08 | Search/CRUD используют тонкие API, не full SSR | Локальный prototype реализует `GET /api/health` и `GET /api/catalog/search` на общем `ProductPage` contract; 47 focused unit/contract tests проходят; real local PostgREST contract прошёл 3/3; настоящий `workerd` gate прошёл 22/22 три раза подряд | PARTIAL | Проверить isolated staging; CRUD ещё не переносился |
| WRK-09 | Worker не содержит Sharp request path | Sharp работает в отдельном Node processor и не импортируется Worker. Добавлены приватная DB-очередь, Node-обработчик задания, R2 S3-адаптер с разделением закрытого staging и публичных файлов и закрытый Supabase RPC-адаптер для claim/finish/fail. Однократный вход проверяет конфигурацию до claim и обрабатывает не более одного задания. Сквозной локальный тест на настоящем Sharp/S3Client и двух HTTP fixtures прошёл успех и два отказа без преждевременной публикации. Итоговая SQL-миграция не исполнена из-за недоступного Docker; настоящий PostgREST, test R2, scheduler и Worker-upload не проверены. Отчёты: `docs/superpowers/reports/2026-10-03-external-photo-processor.md`, `docs/superpowers/reports/2026-10-03-media-jobs-queue.md`, `docs/superpowers/reports/2026-10-03-photo-job-runner.md`, `docs/superpowers/reports/2026-10-03-photo-r2-storage.md`, `docs/superpowers/reports/2026-10-03-photo-job-ports.md`, `docs/superpowers/reports/2026-10-03-photo-local-flow.md`, `docs/superpowers/reports/2026-10-03-one-photo-job-entry.md` | PARTIAL | Прогнать итоговую миграцию на изолированной базе; затем flow с test R2 и Worker-upload |
| WRK-10 | Worker headers и static `_headers` совпадают | Producer генерирует статический `_headers` с CSP и защитными заголовками; полный локальный browser probe проверил 7 классов статических ответов. Ответы Worker (health, поиск: успех/пусто/400/502, 404, 405, аварийный 500) сами несут 7 защитных заголовков: 6 дословно из `next.config.ts` (`Referrer-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Strict-Transport-Security`) и API-CSP `default-src 'none'; frame-ancestors 'none'` вместо сайтовой; `cache-control`/JSON-контракты не менялись. Реальный workerd: 25/25 и 31/31 (со Static Assets) ×3, маркер `_headers` на ответах Worker отсутствует | PARTIAL | Подтвердить совмещённые заголовки на изолированном remote staging; production cutover не выполнялся |
| WRK-11 | Самостоятельный пакет Worker + Static Assets | Свежий `next build` на `49ec35d` прошёл 36/36, полный локальный producer — 90/90 маршрутов. Пакет из этого staging: 180 файлов, Worker 15 501 байт / gzip 4 150 байт; отдельный workerd ответил health 200, поиск 200, product alias 308 и `/catalog` 200. Browser probe: 7/7 классов статических заголовков, 12/12 alias redirect, поиск и навигация без ошибок. Пакет диагностический: browser Supabase origin намеренно непригоден для релиза | PARTIAL | Проверить изолированный remote staging, auth, реальные bindings и Worker Free CPU; до этого не публиковать |

Thin API dry-run воспроизводится без изменения dependency manifest через
`npx --yes wrangler@4.135.0 deploy --dry-run --outdir <temp-dir> --config wrangler.jsonc --env-file <empty-temp-file>`.
На Windows нельзя подставлять `NUL`: Wrangler воспринимает его как относительный путь.
Команда только собирает локальный bundle; upload/deploy и обращение к Cloudflare account не выполняются.

Воспроизводимый runtime gate находится в `scripts/cloudflare/worker-smoke.mjs`.
С Wrangler 4.135.0 он три раза подряд прошёл 22/22 проверки на настоящем
`wrangler dev --local`: health, поиск/фильтры/пагинация, публичный `apikey` без
service-role/Authorization, `offset`/`limit` для POST RPC, out-of-range `416`,
ошибки upstream, 404/405 и санитизированные error-логи.
Gate также проверяет allowlist из четырёх bundle inputs и лимит 16 KiB; измерено
10085 bytes raw и 2871 bytes gzip. Точная локальная команда и границы mock
PostgREST описаны в `scripts/cloudflare/README.md`.

Реальный локальный контракт запускается командой
`npm run test:cloudflare:postgrest`. Runner получает public URL/key из
`supabase status`, запрещает все адреса кроме loopback `:54321` и не печатает
ключ. После запуска локального Supabase три integration case прошли 3/3:
реальный POST `offset`/`limit`, out-of-range `PGRST103/416` и пустой exact count.

## 5. Данные, медиа и публикация

| ID | Контракт | Статус | Обязательное доказательство |
|---|---|---|---|
| DATA-01 | Количество строк превышает/не превышает Supabase `max_rows=1000` | PARTIAL | 87 products, 368 product images и 350 product-brand links ниже порога; `admin_audit_log` содержит 6007 строк, а выборка типов ограничена `.limit(1000)` |
| DATA-02 | Все canonical routes строятся из одного snapshot | PARTIAL | Текущая БД независимо даёт те же 130 sitemap URL, но 7 опубликованных товаров canonical не получают |
| DATA-03 | Mutation не публикует смешанную ревизию | TODO | Revision/outbox integration test |
| DATA-04 | Failed build сохраняет предыдущую публикацию | TODO | `runRevisionedStaticBuild` останавливает diagnostic build до crawl при ошибке; `resolvePublicPackage` только читает пакет, а preview selector меняет лишь локальный preview. Механизма публикации и переключения live-пакета ещё нет, поэтому сохранность предыдущей публикации при сбое не доказана. Нужны отдельный release/rollback design и fault-injection test до cutover |
| DATA-05 | R2 ticket → PUT → process → variants → DB → cleanup | TODO | Test bucket E2E |
| DATA-06 | Retry не создаёт duplicates/orphans | TODO | Idempotency и reconciliation tests |
| DATA-07 | Все публичные media доступны и имеют ожидаемый hash | PARTIAL | 1120 уникальных ссылок БД отвечают HEAD 200 и присутствуют в R2; полное сравнение содержимого по hash не выполнялось |
| DATA-08 | Rollback не откатывает БД и не теряет новые файлы | TODO | Staging rehearsal с mutation pause |

Уточнение DATA-04 (2026-10-04): локальный `runWorkersBuild` теперь принимает результат
только при `ready: true` и ещё раз читает `content_revision` после упаковки.
Смена версии или недоступность чтения отклоняют новый пакет, сохраняя прежний;
три новых теста сначала воспроизвели эти пробелы, затем прошли. Это лишь
дополнительная локальная граница: между последним чтением и удалённой публикацией
всё ещё возможна смена данных; самого переключения и rollback нет. DATA-04
остаётся TODO, `productionReady: false` не меняется.

Уточнение DATA-01 (2026-10-03): `loadCatalogReference()` для CSV-импорта теперь читает все пять справочников порциями по 500 с уникальным порядком и прекращает импорт при ошибке любой страницы. Проверены данные за первой тысячей и отсутствие записи при сбое; `supabase-js` настоящий, HTTP backend в тестах подставлен. Это закрывает конкретный риск обрезания справочника, но не все запросы DATA-01, не транзакционный snapshot и не перенос импорта в Worker. Отчёт: `docs/superpowers/reports/2026-10-03-import-reference-pagination.md`.

Уточнение DATA-01 (2026-10-04): локальный сборщик снимка каталога запрашивает точное число видимых строк PostgREST для каждой страницы и продолжает чтение даже при серверном лимите меньше запрошенных 1000 строк. Отсутствующий/противоречивый `Content-Range` и смена общего числа строк останавливают сборку. RED→GREEN unit-тесты и общий набор 1786 passed / 4 skipped подтвердили код. Изолированный полный smoke с настоящим PostgREST, Next build, crawl, пакетом Worker и Chromium прошёл 14/14 с `cleanup: true`. Отдельный изолированный PostgREST с `max_rows=2` вернул пять товаров за три страницы (`offset` 0, 2, 4), и snapshot содержал все пять; `cleanup: true`. Это закрывает риск обрезания именно локального snapshot, но не все запросы DATA-01. Статус остаётся PARTIAL. Отчёт: `docs/superpowers/reports/2026-10-04-catalog-snapshot-exact-count.md`.

Подтверждённый inventory: R2 production содержит 1127 объектов (192 071 870 байт), включая 1107 product objects, 14 category images, 2 brand logos и 4 hero-видео. В Supabase Storage остаются резервные копии и потенциальные сироты; ничего не удалялось.

## 6. Инфраструктура и cutover

| ID | Контракт/факт | Доказательство | Статус |
|---|---|---|---|
| INFRA-01 | `www` можно переключить Worker Route без изменения DNS | `www` — DNS-only CNAME на Vercel, apex — DNS-only A на Vercel; `CF-Ray` отсутствует | BLOCKED |
| INFRA-02 | Media проходит через Cloudflare/R2 | `media.ayprom-gidravlika.kg` проксируется Cloudflare; 1120 DB URL совпадают с R2 keys | PASS |
| INFRA-03 | Cloudflare production Worker уже существует | Список Workers в аккаунте пуст | TODO |
| INFRA-04 | Production и локальный код совпадают | Vercel production deployment использует commit `f6e5b47`; локальная ветка ушла вперёд | BLOCKED |
| INFRA-05 | Cron cleanup работает | `CRON_SECRET` отсутствует в Production env, вызов cron route без ключа — 401 | BLOCKED |
| INFRA-06 | Sentry активен в production | Переменные `SENTRY_*` отсутствуют в Production env | TODO |
| INFRA-07 | R2 CORS/lifecycle/custom-domain binding подтверждены через API | Плагин не предоставляет нужные чтения; OPTIONS media-домена отвечает 403 без CORS-заголовков | TODO |

## 7. Зависимости и безопасность

| ID | Факт | Влияние | Статус |
|---|---|---|---|
| SEC-01 | Временный vinext graph требует React/ReactDOM 19.3.0 из-за `react-server-dom-webpack@19.3.0` | Нельзя добавлять vinext через `--force` или скрыто ломать peer dependencies | BLOCKED |
| SEC-02 | `npm audit` временного graph: 1 critical и 6 high | Требуется отдельный dependency-upgrade spike; применимость каждого advisory к production ещё не доказана | BLOCKED |
| SEC-03 | Next обновлён с 16.2.11 до 16.3.5 отдельным коммитом `156fe05` | После обновления прошли `npm run check`, `npm run build` (42 страницы) и 13/13 Playwright smoke; это закрывает задачу обновления зависимости, но не подтверждает Cloudflare cutover | PASS |
| SEC-04 | Sharp обновлён с 0.35.3 до 0.35.4 тем же коммитом `156fe05` | Текущие целевые тесты обработки изображений прошли 33/33 (4 файла); они проверяют форматы, размеры, альфа-канал и стабильность результатов, но отдельного эталонного сравнения байтов/изображения после обновления нет | PARTIAL |
| SEC-05 | Secrets были переданы только локальному Wrangler и скрыты в выводе | Значения не попали в Git или отчёт | PASS |

## 8. Решение после compatibility spike

Полный vinext runtime не принимается как production-архитектура AYPROM на текущем этапе. Он подтвердил, что публичные Next-маршруты способны работать в Cloudflare workerd, но не закрыл обязательные контракты админки, Sharp, Worker Free CPU и стабильной установки зависимостей.

Продолжаем архитектуру из основного плана:

1. Static Assets обслуживает предсобранный public без Worker invocation на обычный просмотр.
2. Тонкий Worker обслуживает только auth/API/search/pagination/redirects.
3. Exact Sharp pipeline выполняется в Node build/processor и проверяется golden fixtures.
4. Vercel остаётся действующим rollback-origin до полного staging и периода наблюдения.

## 9. Ближайшие gates

1. Выбрать и проверить схему DNS cutover: proxy для `www` с Vercel-origin либо Workers Custom Domain.
2. Создать минимальный Worker API prototype для `/api/health` и read-only поиска на общем typed contract.
3. Создать минимальный static public prototype из зафиксированного snapshot.
4. Поднять изолированные test Supabase/R2 для mutation E2E.
5. Переписать auth-фазу под фактический `ADMIN_PASSWORD` и только затем выбирать будущий verifier.
6. Для уже обновлённых Next/Sharp сохранить штатные проверки и отдельно закрыть эталонное сравнение изображений; не переносить проблемы временного vinext graph на выбранный тонкий Worker.

До выполнения этих gates запрещены DNS cutover, удаление Vercel, перенос production mutations и объявление отказа от Vercel завершённым.

## 10. Локальная проверка integrity и credential reader — 2026-09-30

Дополнение к историческим снимкам выше, не повторный production-аудит. В изолированной ветке `codex/cloudflare-integration` приняты inventory/границы чтения Cursor (`6879796`, `7746b0e`) и неподключённый reader Claude (`47d6371`). Legacy Next auth и public search не переключались. GET к существующей локальной БД на `127.0.0.1:54321` подтвердил пустую credential row; это не доказательство текущего production-состояния.

Общий check: 1357 passed / 4 skipped, build: 36/36. Свежий admin-preview пакет из ранее проверенного public staging: 182 static assets, SHA-256 inventory на 184 файла, Worker 48 884 байта / gzip 12 172 байт. Локальный Wrangler dry-run и настоящий packaged workerd/browser smoke: 17/17; свой тестовый стек остановлен. `productionReady: false`. Пакеты без inventory отклоняются без дописывания задним числом.

Остаются gates: защита смены версии между проверкой пароля и выдачей сессии перед подключением reader/verifier; admin mutations/media/revision/rollback; свежий release-compatible public build; remote routing/CPU/quota и cutover только с отдельным разрешением. Проверка SHA-256 не является подписью; гонка подмены файлов после проверки не объявляется закрытой. Подробности: `docs/superpowers/reports/2026-09-30-cloudflare-integrity-reader-integration.md`.

Следующая локальная волна 2026-09-30: password/version proof принят (`44a9574` → `8f53e85`) с копированием состояния до crypto await. Общий check 1408 passed / 4 skipped, build 36/36, workerd proof и packaged browser smoke 17/17. Свежий Worker: 49 895 raw bytes / gzip 12 392 bytes; legacy verifier/reader ещё не подключены. Selector `593bbb7` удержан вне integration из-за трёх воспроизведённых отказов сохранности/валидности выбора. DATA-04/08 не повышаются до PASS. Отчёт: `docs/superpowers/reports/2026-09-30-cloudflare-login-proof-selector-review.md`.

Продолжение review 2026-09-30: исправленный selector (`593bbb7` + `06bef22`) принят как `88aa1ce`/`eb45a15`; три прежних дефекта независимо перепроверены. Неподключённая legacy-admin factory Claude (`1610b20`) принята как `5a1533d`, без GoTrue/email/user id и с прежними HTTP boundaries. Совместные focused tests 75/75, общий check 1463 passed / 4 skipped, build 36/36. Новый preview Worker 50 545 raw bytes / gzip 12 496 bytes, inventory проверен; isolated packaged workerd/browser smoke 17/17, cleanup true. В этой исторической точке factory ещё не была подключена к Worker. Ни ADM, ни DATA статусы не повышаются до production PASS. Отчёт: `docs/superpowers/reports/2026-09-30-cloudflare-selector-legacy-ports-integration.md`.

Локальное wiring 2026-09-30: Worker теперь использует credential row/PBKDF2 или ADMIN_PASSWORD только при пустой строке, без GoTrue/email/user id. Новый реальный пакет проверен собственной Supabase и Chromium no-JS: 19/19, включая env/hash вход, отказ env после появления hash, отзыв сессии, hash-only без env и backend outage. Worker 57 502 raw bytes / gzip 14 170 bytes, inventory проверен, productionReady false. Cursor resolver (`57b731b`) и Claude race runtime (`3565c46`) приняты; Codex исправил несовпадение допустимых dotted package names. ADM-01/02/03/13 остаются PARTIAL, ADM-04–09 не объявляются реализованными. Next/Vercel и production auth не переключались. Отчёт: `docs/superpowers/reports/2026-09-30-cloudflare-legacy-auth-wiring.md`.

Локальное продолжение 2026-10-01: для существующего PBKDF2-хеша вынесены проверка/создание в защищённую Supabase Edge Function, без миграции на Supabase Auth. Подключена защищённая смена пароля с CAS-версией и отзывом старых cookie. `npm run check`: 1584 passed / 4 skipped; свежий static build 36/36 и crawl 90/90. Новый admin-preview пакет: 183 assets, Worker 72 843 bytes / gzip 16 655 bytes, inventory проверен, `productionReady: false`; изолированный packaged workerd + Supabase Edge Runtime + браузер без JS: 21/21, cleanup true. Это не remote CPU/quota proof и не production parity; ADM-03/04 остаются PARTIAL. Отчёт: `docs/superpowers/reports/2026-10-01-cloudflare-free-admin-crypto.md`.

Основа для публикации правок каталога, 2026-10-01: новая **локальная, не применённая к production** миграция добавляет транзакционный `content_revision`. Правки 11 публичных таблиц повышают его; откат SQL-транзакции откатывает и повышение. Публичная роль может только читать номер версии. В отдельном временном Supabase миграция применилась, pgTAP 13/13 и настоящий PostgREST подтвердил чтение `0`, затем `1` после тестовой записи; стек остановлен и удалён. `npm run check`: 1584 passed / 4 skipped. Это лишь предохранитель для будущей сборки: сборщик пока **не сравнивает** версию до и после работы, admin mutations не подключены, автоматическая публикация и rollback не реализованы. Не повышать ADM-05–09 или production readiness. См. `docs/superpowers/reports/2026-10-01-cloudflare-publication-revision-foundation.md`.

Продолжение того же локального этапа: Node-side библиотека читает `get_content_revision` только публичным ключом и оборачивает подготовку staging сравнением версии до/после. 19 unit-тестов прошли; изолированный реальный PostgREST подтвердил отказ при правке между двумя чтениями и успех при стабильной версии. Полный `npm run check`: 1603 passed / 4 skipped. Библиотека **ещё не подключена** к полному `next build` → crawl → package → promotion, поэтому безопасность реальной публикации не доказана; `productionReady: false` сохраняется.

Локальная браузерная проверка 2026-10-02: после подключения revision fence к настоящим сборке и пакету изолированный стенд с 30 учебными товарами прошёл Next build, crawl 39/39, packaged workerd и Chromium. `/catalog`, плоская категория и тип техники показали по 6 товаров на второй странице как по прямому URL, так и после клика «Вперёд»; ошибок браузера и локальных HTTP-запросов нет. `npm run check`: 1638 passed / 4 skipped. Исправлено повторное использование старого Next fetch cache между диагностическими сборками. Это не полный production-каталог, не удалённый Cloudflare и не доказательство Worker Free лимитов; `productionReady: false`. Отчёты: `docs/superpowers/reports/2026-10-02-local-30-product-browser-gate.md`, `docs/superpowers/reports/2026-10-02-local-scoped-pagination-browser-gate.md`.

Дополнение 2026-10-03: изолированный стенд теперь содержит непустые страницы категории-бренда и бренда-подкатегории (по 26 учебных товаров). Публичный `search_catalog_products` с publishable key вернул вторую страницу 24–25/26 для обоих фильтров. Полный локальный Next build → crawl (124/124) → пакет → workerd → Chromium прошёл 36/36 browser checks без page errors, local HTTP errors и uncaptured prefetches. Для страницы бренда-подкатегории Chromium проверил поиск, прямой `?page=2`, кнопку «Вперёд», фактический href карточки второй страницы и переход по её фото на один canonical product URL; адрес карточки после поиска также совпал с canonical. База стенда очищена. Это доказательство локального поведения, а не remote staging, production parity или готовности к cutover; `productionReady: false` остаётся.

Дополнительный локальный mobile-gate 2026-10-03: тот же изолированный полный стенд прошёл 41/41 browser checks, включая Chromium с touch/viewport 390×844. На узком экране проверены отсутствие горизонтального переполнения каталога (390/390 px), раскрытие меню и переход в категорию, поиск через публичный API, кнопка второй страницы (24 товара) и переход по фото товара. Page errors, локальных HTTP-ошибок и ошибок предзагрузки — 0; временная база остановлена. Это не визуальное сравнение с production и не удалённый Cloudflare; статус PUB-09 этим не меняется.

Уточнение mobile-gate 2026-10-03: к этому стенду добавлена проверка клавиатуры и Escape с возвратом видимого фокуса; полный повторный прогон прошёл 42/42 browser checks, 0 page/HTTP/prefetch errors, cleanup true. Исправлена гонка самой браузерной проверки: после перехода по фото товара она теперь ждёт появления H1, как уже делала desktop-ветка. PUB-10 повышен только до PARTIAL: проверка в локальном Chromium не заменяет полный аудит доступности и удалённый staging.
