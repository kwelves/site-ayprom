# План устранения QA-дефектов

## Паспорт документа

| Поле | Значение |
|---|---|
| Статус | Активный источник истины; фазы 0–2 завершены, фаза 3 в работе. QA-001, QA-002, QA-003 и QA-012 закрыты; QA-004…QA-011 остаются открытыми |
| Дата baseline | 2026-08-24 |
| Baseline Git | `a201d1e` (`main`) |
| Область | Публичный каталог, административная панель, Supabase, Storage, сборка и эксплуатационные проверки |
| Правило обновления | После каждого checkpoint обновлять статусы, решения, результаты проверок и changelog этого документа |

Этот документ фиксирует согласованный порядок устранения QA-находок. Реестр объединяет подтверждённые кодом дефекты и риски/гипотезы, которым ещё нужна browser-проверка; запись в реестре сама по себе не доказывает дефект и не означает, что он уже исправлен. На baseline в репозитории не было конфигурации Playwright и самостоятельного E2E-набора; фаза 1 добавила и независимо проверила воспроизводимый browser harness.

### Иерархия источников

- `PROJECT_BRIEF.md` задаёт три фиксированных продуктовых ограничения и живую продуктовую направленность.
- Этот документ является рабочим источником истины для QA-фаз 0–8, acceptance evidence и статусов закрытия.
- `docs/ROADMAP.md` сохраняется как исторический контекст раннего аудита и прежних решений. Его фазы не соответствуют QA-фазам этого документа; конфликтующие, устаревшие или незавершённые инструкции из `ROADMAP` не исполняются без повторной проверки актуального состояния и отдельного разрешения пользователя.

## Цель и границы

Цель — устранить подтверждённые дефекты, проверить отмеченные риски и снизить вероятность регрессий без редизайна, смены продуктовой модели или незаявленного расширения функциональности.

В рамках плана:

- укрепить целостность продуктовых мутаций и контрактов сортировки;
- заменить уязвимую архитектуру загрузки нескольких фотографий на staged upload;
- выполнять distributed rate-limit reservation до дорогой проверки пароля;
- уменьшить стоимость hero-медиа без потери качественного master;
- связать сохранённые SEO-поля с публичными metadata и закрыть глобальный 404;
- исправить доступность, узкие экраны и нестабильные области нажатия;
- сделать проверки и сборку воспроизводимыми.

Вне рамок:

- новый визуальный стиль, новая информационная архитектура или смена навигационной модели;
- цены, корзина, оплата, checkout, статусы наличия и AI-поиск;
- автоматическое изменение production-БД, Supabase Storage, DNS, Cloudflare или deployment;
- удаление или замена качественных media master ради произвольного ограничения размера.

## Фиксированные продуктовые ограничения

`PROJECT_BRIEF.md` прямо называет фиксированными только следующие ограничения:

1. Сайт остаётся каталогом, а не интернет-магазином: нет корзины, онлайн-оплаты и checkout.
2. В первой версии цены не показываются.
3. Каталожные данные и административный доступ должны оставаться защищёнными.

Они не меняются этим remediation-планом. Остальные положения brief являются текущей направленностью и могут уточняться по его собственным правилам после обсуждения tradeoffs.

## Текущие scope-preservation assumptions

Ниже зафиксирован текущий контракт реализации и README, который сохраняется в рамках QA-remediation, но не объявляется вечным immutable-ограничением `PROJECT_BRIEF.md`:

1. Supabase остаётся источником истины production-каталога; production-страницы не используют hardcoded mock catalog fallback.
2. Публичное чтение использует publishable key и защищено RLS; secret/service-role key доступен только серверному коду.
3. Изменения схемы фиксируются версионированными SQL-миграциями, ревьюятся и локально тестируются до remote application.
4. Каталог рассчитан примерно на 2 000 товаров; backend pagination/search сохраняются. Лимит **24 карточки на текущую страницу** — действующий implementation/README contract, а не неизменяемый продуктовый предел.
5. Поиск остаётся основным способом сужения каталога и охватывает название, артикул, бренд, категорию и характеристики. AI-поиск не добавляется в рамках этого плана.
6. Сохраняются Next.js App Router, TypeScript, Tailwind CSS и переиспользуемые компоненты.
7. Качественный raster/video master хранится минимум в 2K, предпочтительно 4K. Для доставки создаются проверенные responsive derivatives; master не ухудшается только ради файлового бюджета.
8. SVG остаётся векторным: его нельзя растрировать или апскейлить; должны сохраняться корректный `viewBox`, paths и отсутствие встроенного низкокачественного raster.
9. Обязательные публичные страницы, административные разделы, состав карточки/страницы товара и заметный доступный WhatsApp badge сохраняются.
10. Статусы наличия, новый visual style, новая navigation model и другие неоговорённые продуктовые расширения не вводятся в рамках remediation. Это граница текущего scope, а не новое фиксированное требование brief.

## Severity и статусы

- `S0 Critical` — риск обхода security boundary, потери/повреждения данных или недоступности критического потока.
- `S1 High` — существенный production-дефект, ненадёжный ключевой сценарий или крупная регрессия производительности.
- `S2 Medium` — заметный функциональный, SEO, accessibility или responsive-дефект с обходным путём.
- `S3 Low` — качество кода/сборки и долговременная поддерживаемость без немедленного пользовательского ущерба.
- Статусы: `Открыт`, `В работе`, `Заблокирован`, `Готов к проверке`, `Закрыт`, `Принят риск`.

## Реестр QA-находок

| ID | Severity | Evidence / текущее поведение baseline | Целевое поведение | Области | Фаза | Статус |
|---|---|---|---|---|---:|---|
| QA-001 | S1 | В baseline нет `playwright.config.*` и выделенного E2E-набора; текущие unit/integration проверки не подтверждают реальное browser-поведение. | Воспроизводимый preflight и Playwright smoke/regression suite для критических public/admin flows, desktop/mobile и консольных ошибок. | test tooling, CI, docs | 1 | Закрыт |
| QA-002 | S0 | `createProduct` вставляет товар, затем связанные таблицы отдельными запросами с компенсирующим delete; `updateProduct` обновляет row и пересоздаёт связи отдельными операциями. Частичный сбой не является единой DB-транзакцией. | `create_product_with_relations` и `update_product_with_relations` выполняют связанные изменения атомарно, проверяют вход и конкуренцию; ошибка не оставляет частичное состояние. | admin actions, Postgres, migrations, pgTAP | 2 | Закрыт |
| QA-003 | S1 | Reorder RPC выполняют update по переданным идентификаторам, но большинство не доказывают полноту, уникальность и принадлежность переданного набора; image reorder action отдельно принимает `productSlug`, не передавая его RPC. | Строгие контракты: дубликаты, неизвестные/чужие ID и неполный недопустимый набор отвергаются; допустимый filtered/page reorder сохраняет оговорённые slots атомарно. | admin DnD, Postgres RPC, pgTAP | 2 | Закрыт |
| QA-004 | S1 | Create-mode передаёт все `photos` внутри одного Server Action `FormData`, до создания товара валидирует и обрабатывает их, затем сервер загружает их отдельными параллельными server-side Storage-вызовами в публичный `product-images`. Поток зависит от общего request payload/CPU/time budget. | Сначала создаётся draft, файлы независимо и напрямую грузятся по ограниченным signed tokens в private staging bucket. Finalize повторно валидирует originals; DB metadata изменяется атомарно внутри Postgres, а Storage+DB координируются идемпотентной state machine без обещания общей ACID-транзакции. Объект не публикуется до успешной revalidation/finalize; cleanup/reconcile безопасно устраняет незавершённые состояния. | ProductForm, Server Actions, Storage, lifecycle | 3 | Открыт |
| QA-005 | S0 | `login` сначала получает credential и выполняет `verifyAdminPassword`/PBKDF2, а `registerLoginAttempt(passwordIsValid)` вызывается после проверки. Blocked-запрос всё равно расходует дорогой password-hash budget. | Атомарная reservation до PBKDF2 отклоняет blocked/overflow попытки; завершение reservation фиксирует success/failure; защита остаётся distributed и fail-closed. | admin auth, Postgres RPC, observability | 4 | Открыт |
| QA-006 | S1 | Hero сразу рендерит `autoPlay` video с `preload="metadata"`, статического poster нет. Текущие derivatives: desktop 25 544 496 B, mobile 22 588 953 B. | Poster-first; видео не стартует SSR-автозагрузкой и загружается/воспроизводится только при видимости и допустимых user/network preferences. Visual quality и loop проверены. | Hero, media pipeline, performance | 5 | Открыт |
| QA-007 | S2 | Админка сохраняет `meta_title`/`meta_description`, но публичный `PRODUCT_SELECT` и `Product` mapping их не читают; публичная metadata не может использовать сохранённые значения. | Единый metadata helper использует валидные поля товара с безопасными fallback и canonical; существующие значения становятся видимыми в публичных metadata. | public queries, product routes, SEO tests | 6 | Открыт |
| QA-008 | S2 | Есть сегментный `src/app/(site)/not-found.tsx`, но нет корневого/global not-found для запросов вне public route group; `globalNotFound` не включён. | Полная русскоязычная глобальная 404-страница корректно работает для неизвестного URL при нескольких root layouts и содержит собственные HTML/body зависимости. | Next config, app routing, SEO/E2E | 6 | Открыт |
| QA-009 | S2 | В header часть disclosure-controls не связана через `aria-controls`; требуется полная проверка Escape/focus return. Login page использует внешний `div`, не `<main>`. `BackButton` без fallback всегда вызывает `router.back()`. | Семантика, accessible name/state/relationship, Escape, predictable focus, безопасный fallback back navigation и keyboard-visible focus подтверждены браузером. | header, admin login, navigation, a11y | 7A | Открыт |
| QA-010 | S2 | Real browser evidence подтвердил P2-наблюдения: каталог визуально слишком плотный на 320/390, floating WhatsApp button перекрывает область карточки, а на странице встречается большой белый интервал при прокрутке. Исправление дизайна не подтверждено и отложено до фазы 7; анимированный/dragged target карусели также остаётся в системном reflow-аудите. | Browser-аудит сначала фиксирует воспроизводимые случаи; исправляются только подтверждённые overflow/overlap/click defects. На проверенных экранах нет непреднамеренного overflow, controls не перекрываются, touch-targets около 44 px, а подтверждённо нестабильная карусель получает hit-wrapper без изменения характера motion. | responsive UI, carousel, mobile admin/public | 7B | Открыт |
| QA-011 | S3 | `poweredByHeader` явно не выключен; font/build/dependency contracts и неиспользуемые файлы требуют инвентаризации. Сборка есть, но её детерминизм и чистый-install путь должны быть закреплены. | Локальный шрифт без runtime fetch, `poweredByHeader: false`, прямые зависимости и Node contract согласованы, dead code удалён только после доказательства, clean install/check/build воспроизводимы. | Next config, fonts, package, repo hygiene | 8 | Открыт |
| QA-012 | S1 | Границы scale закрыты в фазе 2: значения измерены read-only по production (все заполненные лежали в 0.75–1.6, `product_images.scale` не заполнен ни разу), диапазон 0.1–5.0 закреплён в UI, на сервере и CHECK-констрейнтами на всех трёх колонках. Server-side проверка содержимого закрыта в фазе 3: обнаружено, что логотипы брендов и картинки категорий не проверялись вообще, а расширение бралось из имени файла; теперь тип и расширение выводятся из проверенного содержимого, SVG обезвреживается через isomorphic-dompurify с отказом (а не тихой вычисткой), а сами Storage buckets получили file_size_limit и allowed_mime_types. | Scale bounds закреплены UI + server + DB constraints; опасные/несовместимые файлы отклоняются по содержимому, а не только имени/MIME. | validation, DB constraints, uploads | 2–3 | Закрыт |

### Важные предварительные параметры

- Бюджеты hero derivative **3 MB для mobile и 5 MB для desktop — предварительные**, до измерений сети, LCP и визуального сравнения. Они не являются разрешением ухудшить master или заметно снизить качество.
- Допустимые bounds для `scale` **не заданы заранее**. Production-распределение значений измеряется в preflight; только после этого выбираются ограничения UI/server/DB и план нормализации outliers.
- Библиотека/sanitizer для SVG **ещё не выбраны**. Нельзя внедрять regex-only sanitizer. Выбор требует проверки поддержки `viewBox`, paths, namespaces, embedded raster, scripts/event handlers и серверной среды.
- Private staging bucket и его lifecycle требуют **отдельного infra approval**. Фаза 3 не означает автоматическое создание/изменение remote Storage.

## Фазы, зависимости и Definition of Done

### Фаза 0 — контракт remediation

Зависимости: baseline `a201d1e`, `PROJECT_BRIEF.md`, подтверждённые кодом находки и явно помеченные риски, требующие browser-аудита.

Результат:

- создан этот живой документ и ссылка из `README.md`;
- зафиксированы постоянные ID, границы, зависимости, DoD, полномочия и release order;
- неизвестные параметры помечены как open questions, а не выданы за решения.

Definition of Done:

- tracked diff проходит `git diff --check`, а новые untracked документы отдельно проверены эквивалентной whitespace-проверкой (обычный `git diff --check` их не охватывает);
- все фазы 0–8, QA ID и обязательные разделы доступны по заголовкам;
- не заявлено исправление открытых проблем или существование browser/E2E coverage;
- diff ограничен этим документом и ссылкой в README.

### Фаза 1 — baseline, preflight и regression harness

Зависимости: фаза 0.

Работы:

- зафиксировать environment preflight: Node/npm, env presence без вывода секретов, доступность local Supabase/Docker и браузеров;
- добавить Playwright с отдельными public/admin projects и безопасным тестовым состоянием;
- smoke: главная, каталог/поиск/пагинация, product route, 404, login failure/rate limit UX, базовый admin CRUD в изолированной среде;
- viewport matrix 320/375/390/768/desktop, console/page errors, keyboard path и скриншотные baseline артефакты;
- добавить regression tests на выявленные дефекты до их исправления, где это practically possible.

Definition of Done:

- документирована команда локального запуска и CI-режим;
- тесты не зависят от production writes и очищают только собственные fixtures;
- есть доказанный failing/pending coverage для QA-002…QA-012 либо явно описанное ограничение;
- `npm run check`, smoke suite и browser artifacts воспроизводимы на поддерживаемой среде.

Статус: **завершена после независимой локальной verification**. QA-001 закрыт; QA-002…QA-012 остаются открытыми и переходят в соответствующие фазы 2–8.

### Фаза 2 — целостность product mutations, reorder и scale

Зависимости: фаза 1; local Supabase/Docker или отдельно согласованная безопасная test DB.

Работы:

- добавить декларативную схему и versioned migrations для атомарных `create_product_with_relations`/`update_product_with_relations`;
- валидировать references, массивы, дубликаты, права вызова, publication side effects и ожидаемую версию (`expected_updated_at`/CAS);
- усилить reorder contracts с явной семантикой полного набора и filtered/page subset;
- измерить production scale values read-only, выбрать bounds, добавить нормализацию и constraints;
- расширить pgTAP: success, rollback на каждой child relation, stale update, duplicate/foreign/missing reorder IDs, grants/RLS.

Definition of Done:

- ни один тестовый failure injection не оставляет частичный товар/связи;
- stale edit не затирает более новую редакцию молча;
- strict reorder отвергает некорректный набор без частичного update;
- bounds подтверждены измерениями, а существующие данные совместимы или имеют проверенную миграцию;
- local reset, pgTAP, app tests и build проходят; remote schema не изменена без approval;
- локальная декларативная схема и миграции согласованы. Remote `schema:check` до отдельно одобренного provisioning может иметь документированный expected drift/pending status и не считается PASS; обычный PASS обязателен после provisioning как release gate.

Статус: **завершена после локальной verification**. QA-002 и QA-003 закрыты. QA-012 закрыт наполовину: bounds измерены и закреплены на трёх уровнях, server-side content validation переходит в фазу 3 вместе с QA-004.

Принятые в фазе решения и осознанные исключения:

- **Границы scale выбраны по измерению, а не назначены.** Read-only `SELECT` к production показал: `product_images.scale` не заполнен ни разу (346 строк), `brands.logo_scale` заполнен у 8 строк в диапазоне 0.75–1.6, `category_brands.logo_scale_override` — у 5 в диапазоне 0.95–1.15; значений ≤ 0 и > 5 нет нигде. Диапазон 0.1–5.0 даёт более чем трёхкратный запас и совместим с обеими средами. Значение вне диапазона отвергается, а не обрезается до границы.
- **Закрыты все три scale-колонки**, хотя QA-012 называет только `product_images.scale`: остальные две имели тот же дефект и вернулись бы отдельной находкой.
- **Все семь reorder RPC приведены к модели слотов.** Прежде их было две несовместимых: `reorder_products` переставлял записи внутри уже занятых значений `order`, остальные присваивали абсолютные `ordinality - 1` и на неполном наборе молча сталкивали подмножество со строками вне набора.
- **`UNIQUE (product_id, "order")` для `product_images` сознательно отложен в фазу 3.** Модель слотов — перестановка уже занятых значений и сама создать дубликат не может; найденный в production дубликат (`korobka-otbora-moschnosti-lkf-atego-2`, две фотографии на `order = 3`) пришёл из пути загрузки, где клиент вычисляет `order` из локального состояния формы. Констрейнт до переписывания этого пути (QA-004) превратил бы устаревшую вкладку в ошибку загрузки, не устранив причину. Миграция при этом нормализует существующий порядок в плотный детерминированный 0..n-1.
- **CAS выполняется по строке, а не по разобранному значению.** `updated_at` хранится с микросекундной точностью; `new Date(...).toISOString()` обрезает до миллисекунд, поэтому разбор версии в `Date` на любом участке пути сделал бы каждое сохранение ложным конфликтом. Проверено на живых данных: `…21.195707+00:00` против `…21.195Z`.
- **`p_expected_updated_at IS NULL` отвергается fail-closed**, иначе устаревшая вкладка, не приславшая поле, обошла бы проверку молча.
- **Ошибки RPC оборачиваются осознанно.** `PostgrestError` в рантайме не является экземпляром `Error` (проверено на живом клиенте), поэтому общий `getErrorMessage` подменял бы текст на generic. Намеренные коды (`22023`, `55000`) доходят до администратора дословно, неожиданные скрываются за общим текстом и уходят в серверный журнал, чтобы имена констрейнтов не утекали в интерфейс.
- **Найдено и исправлено расхождение `supabase/schemas/prod.sql` с миграциями**: `categories.type` значился `NOT NULL` со старым CHECK, хотя миграция `20260819021520` сделала колонку nullable. Исправлено, так как DoD фазы прямо требует согласованности.
- **Браузерных проб для QA-002/QA-003 намеренно нет**: браузер не может ни прервать транзакцию на середине, ни отправить набор идентификаторов, которого интерфейс не формирует. Вместо этого добавлена проба на то, что pgTAP увидеть не может — видимость и текст отказа при конфликте версий (`tests/e2e/admin/product-version-conflict.spec.ts`).

### Фаза 3 — staged direct upload и Storage lifecycle

Зависимости: фазы 1–2; закрытые entry decisions ниже; отдельное одобрение Storage provisioning для remote среды.

Entry decisions до начала implementation:

- TTL для draft, signed upload token и abandoned staging/retention;
- максимальный размер одного файла и максимальное количество файлов на товар/операцию;
- владелец и механизм запуска cleanup/reconciliation (scheduler/runner), retry policy и observability;
- конкретная SVG sanitizer/library, allowlist и server-runtime compatibility; regex-only sanitization запрещена.

Работы:

- создать draft/finalize state machine и private `product-image-staging` contract;
- server выдаёт короткоживущий signed upload token только для scoped path, типа, размера и лимита количества;
- browser загружает каждый файл независимо с progress/retry/cancel;
- finalize сервером скачивает/читает исходный объект, повторно проверяет signature/content/dimensions, безопасно обрабатывает raster и санитизирует допустимый SVG;
- publish/attach выполняется после повторной валидации; cleanup удаляет expired drafts, abandoned staging и orphan files идемпотентно;
- прямой public upload и доверие к client MIME/path запрещены.

Definition of Done:

- create/edit multi-photo flow не передаёт файлы через общий product Server Action payload;
- invalid/oversized/spoofed file не попадает в public bucket/DB;
- DB metadata commit атомарен внутри Postgres; между Storage и Postgres не заявляется общая ACID-гарантия;
- Storage+DB workflow реализован как идемпотентная state machine: объект не становится публичным и не прикрепляется к опубликованному товару до успешной server-side revalidation/finalize;
- retry не создаёт дубликаты, cancel и partial failure понятны пользователю; cleanup/reconcile сходится без дублей и потерь подтверждённых final-объектов;
- lifecycle job и reconciliation имеют метрики/логи и доказанные idempotency tests;
- local `supabase db reset`, pgTAP, Storage lifecycle и permission tests проходят;
- remote `schema:check` до одобренного provisioning может оставаться в документированном expected drift/pending mode; полный PASS обязателен после provisioning как release gate;
- доступ к private staging и public final objects проверен; remote bucket создаётся только после approval.

### Фаза 4 — auth rate-limit reservation до PBKDF2

Зависимости: фазы 1–2; согласованный reservation protocol.

Работы:

- заменить post-verification registration на `begin_admin_auth_attempt` перед PBKDF2 и `finish_admin_auth_attempt` после неё;
- reservation атомарно проверяет window/block/concurrency budget и fail-closed поведение;
- завершение success очищает/обновляет состояние, failure учитывается один раз; abandoned reservations имеют TTL/reconciliation;
- исключить user enumeration и утечки password/IP в logs; constant-time credential handling относится к попыткам, допущенным reservation к PBKDF2. Ранний rate-limit отказ намеренно не выполняет PBKDF2 и может отличаться по времени, поэтому его ответы/сообщения не должны раскрывать валидность credential.

Definition of Done:

- blocked request доказанно не запускает PBKDF2;
- конкурентные попытки не обходят лимит и не double-countятся;
- DB/RPC outage запрещает вход fail-closed с безопасным UX;
- pgTAP + unit + integration tests покрывают boundary, expiry, success, failure и concurrency;
- административный вход и смена пароля работают в разрешённом сценарии.

### Фаза 5 — hero poster, network gating и media budgets

Зависимости: фаза 1; найденный high-quality master; измерения и визуальное утверждение derivatives.

Работы:

- создать responsive poster derivatives и оставить master неизменным;
- убрать SSR `autoPlay`/агрессивную preloading семантику; poster видим сразу;
- загружать видео только когда hero близко/находится во viewport и позволяют reduced-motion, Save-Data/effective connection и page visibility;
- pause/resume без лишних reload; graceful fallback при error;
- подобрать codecs/CRF/resolution по качеству, измерить transfer/LCP и loop.

Definition of Done:

- при JS off, reduced motion, Save-Data, slow connection и video error hero остаётся читаемым и визуально завершённым;
- нет загрузки полного видео до выполнения gate;
- quality review на mobile/desktop не выявляет blur, halos, banding, broken loop или distorted details;
- performance traces показывают улучшение или отсутствие регрессии LCP/transfer;
- окончательные бюджеты записаны по измерениям; предварительные 3/5 MB не применены вслепую.

### Фаза 6 — SEO metadata и global 404

Зависимости: фаза 1; релевантная документация установленной Next.js 16 прочитана до кода.

Работы:

- включить `meta_title`/`meta_description` в public product contract;
- централизовать title/description/canonical/OpenGraph fallback и sanitization;
- добавить полный global not-found для нескольких root layouts и необходимую Next config опцию;
- сохранить сегментные 404 там, где они дают более точный контекст.

Definition of Done:

- custom SEO values и fallback values проверены unit/E2E тестами;
- unknown public/admin/root URL возвращает ожидаемый 404 и русскоязычный документ без runtime error;
- canonical стабилен, секретные/draft данные не попадают в metadata;
- `npm run check`, build и browser tests проходят.

### Фаза 7A — accessibility без намеренных визуальных изменений

Зависимости: фаза 1.

Работы:

- добавить корректные `aria-expanded`, `aria-controls`, ids и accessible labels;
- Escape закрывает menu/dialog/sheet, focus возвращается opener, tab order предсказуем;
- login получает `<main>`, BackButton — безопасный fallback при отсутствии полезной history;
- стабильная неанимированная hit-wrapper отделяется от animated/dragged visual node там, где теряются clicks;
- focus-visible сохраняется и не скрывается.

Definition of Done:

- keyboard-only сценарии проходят в реальном браузере;
- automated accessibility scan не имеет новых serious/critical violations;
- screen-reader semantics проверены инспекцией accessibility tree;
- desktop screenshots не имеют непредусмотренных визуальных отличий;
- timing, easing и характер существующих анимаций не изменены.

### Фаза 7B — контролируемый mobile reflow

Зависимости: фазы 1 и 7A.

Работы:

- сначала воспроизвести и зафиксировать browser evidence, затем исправлять только подтверждённые overflow/overlap на 320–380 px через wrap/stack/min-width/containment;
- сохранить понятные touch-targets около 44 px и safe-area spacing;
- проверить формы, admin lists, bulk actions, header, каталог, product gallery/carousel и WhatsApp badge;
- desktop layout менять только если это непосредственно устраняет дефект.

Definition of Done:

- на 320, 375, 390, 768 и desktop нет непреднамеренного horizontal scroll, clipping или overlap;
- все критические controls достижимы touch и keyboard;
- before/after screenshots рассмотрены, разрешённые отличия перечислены;
- нет изменений цветов, typography system, content hierarchy или motion language.

### Фаза 8 — deterministic build и code hygiene

Зависимости: функциональные фазы 2–7 завершены; релевантная local Next documentation прочитана.

Работы:

- использовать локальный font asset/API и исключить build-time/runtime network dependency шрифта;
- задать `poweredByHeader: false`;
- согласовать `.nvmrc`, `engines`, CI и фактически поддерживаемые Node/npm versions;
- добавить прямую зависимость `@next/env`, если проект импортирует её напрямую;
- удалить unused/archive code только после `rg`, import graph и build evidence; сохранить согласованные архивные ресурсы;
- clean install и build должны давать одинаковый результат без незафиксированных генераций.

Definition of Done:

- `npm ci`, `npm run check`, `npm run build`, relevant schema/browser tests проходят из чистого checkout;
- нет незаявленного font fetch и `X-Powered-By` header;
- lockfile соответствует manifest, Node contract документирован;
- список удалённых/сохранённых файлов зафиксирован; пользовательские ресурсы не затронуты.

## Traceability: находка → доказательство → закрывающая фаза

QA ID переводится в `Закрыт` только после получения указанного acceptance evidence. Завершение работ по фазе без этого доказательства не закрывает находку.

| QA ID | Acceptance evidence / тест | Закрывающая фаза |
|---|---|---:|
| QA-001 | Playwright config и изолированные public/admin smoke запускаются документированной командой; browser artifacts, console/page-error checks и CI/local mode воспроизводимы. | 1 |
| QA-002 | pgTAP failure injection для каждой child relation подтверждает полный rollback; integration tests подтверждают success и CAS stale-update rejection. | 2 |
| QA-003 | pgTAP/RPC tests отклоняют duplicate, foreign, unknown и недопустимо missing IDs без partial update; допустимый full/subset contract проверен отдельно. | 2 |
| QA-004 | Browser/integration flow загружает несколько файлов независимо; content revalidation, idempotent finalize/retry/cancel и cleanup/reconcile tests доказывают отсутствие преждевременной публикации, дублей и потери подтверждённых final-объектов. | 3 |
| QA-005 | pgTAP + integration concurrency tests доказывают reservation до PBKDF2, отсутствие hash work для blocked request, single accounting, TTL и fail-closed outage. | 4 |
| QA-006 | Network trace подтверждает poster-first и отсутствие video transfer до gate; сценарии reduced-motion/Save-Data/slow/error и visual loop review проходят на mobile/desktop. | 5 |
| QA-007 | Unit/E2E tests подтверждают custom и fallback metadata, canonical и отсутствие draft/secret data в публичном HTML. | 6 |
| QA-008 | Browser/E2E для неизвестных public/admin/root URL подтверждает русскоязычный 404-документ, корректный status и отсутствие runtime errors. | 6 |
| QA-009 | Keyboard-only сценарии, accessibility tree и automated scan подтверждают disclosure relationships, Escape/focus return, `<main>`, BackButton fallback и visible focus. | 7A |
| QA-010 | Сначала сохранены browser evidence и baseline screenshots конкретных дефектов; затем before/after matrix 320/375/390/768/desktop подтверждает исправление только воспроизведённых overflow/overlap/click issues без desktop/motion regression. | 7B |
| QA-011 | Чистый `npm ci` + check/build проходит на согласованной Node version; нет font network fetch и `X-Powered-By`, lockfile/manifest согласованы, удаления подтверждены import graph. | 8 |
| QA-012 | Фаза 2 доказывает measured scale bounds и UI/server/DB constraints; фаза 3 доказывает server-side content validation/sanitization и rejection spoofed formats. ID закрывается только после прохождения обоих наборов evidence. | 3, после 2 и 3 |

## Матрица проверок

| Проверка | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7A/7B | 8 | Перед релизом |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Tracked `git diff --check` + отдельная проверка untracked | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `npm run lint` / `typecheck` / `test` | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `npm run build` | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Playwright public smoke | — | создать | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Playwright admin smoke | — | создать | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 320/375/390/768/desktop screenshots | — | baseline | по риску | upload UI | login | hero | 404/product | обязательно | итог | обязательно |
| Keyboard/a11y tree/automated scan | — | baseline | по риску | upload UI | login | hero controls | 404 | обязательно | итог | обязательно |
| `supabase db reset` + pgTAP | — | preflight | обязательно | обязательно | обязательно | — | по схеме | — | — | обязательно |
| `npm run schema:check` (remote) | — | preflight | pending допустим до approval | pending допустим до provisioning | pending допустим до approval | — | если schema | — | — | PASS после provisioning |
| DB grants/RLS/advisors | — | inventory | обязательно | обязательно | обязательно | — | при изменениях | — | — | обязательно |
| Storage permission/lifecycle tests | — | baseline | — | обязательно | — | — | — | — | — | обязательно |
| Media visual/performance inspection | — | baseline | — | upload previews | — | обязательно | — | motion regression | — | обязательно |
| Production smoke/observability | — | — | только после release | только после release | только после release | только после release | только после release | только после release | только после release | обязательно |

`—` означает «не обязательна именно для этой фазы», а не запрет на запуск. Любое изменение с более широким риском расширяет набор проверок. Для фаз со схемой локальные `supabase db reset`, pgTAP и проверки permissions/lifecycle обязательны. Remote `schema:check`, который видит ещё не provisioned изменения, фиксируется как документированный expected drift/pending, а не маскируется под PASS; обычный PASS обязателен после отдельного approval и provisioning как release gate.

## Контролируемые визуальные изменения 7A/7B

### 7A — визуально нейтральные изменения

Разрешены DOM/semantic wrappers, ARIA-атрибуты, focus management, Escape handling, стабильная hit-area и `<main>`. Не разрешены изменения palette, typography, spacing system, animation timing/easing и desktop composition. Focus-visible может стать заметнее только там, где существующее состояние не удовлетворяет keyboard accessibility.

### 7B — видимый, но ограниченный reflow

После воспроизведения конкретного дефекта на 320–380 px разрешены перенос строк, stack вместо row, увеличение слишком маленькой области касания и safe-area отступ. Само наличие риска QA-010 не разрешает массовую перекомпоновку: изменения вносятся только для подтверждённых browser-аудитом случаев. Любое отличие на desktop должно иметь прямую связь с зарегистрированным дефектом. До/после фиксируются скриншотами на 320, 375, 390, 768 и desktop; непредусмотренное отличие считается регрессией.

## Полномочия и запреты

Локальная реализация, тесты, декларативная схема и ещё не применённые миграции допустимы в рамках отдельно запущенной фазы. Следующие действия **не разрешены этим планом** и требуют отдельного явного разрешения пользователя:

- `git push`, PR merge, deployment или promotion в production;
- применение миграций к remote/production Supabase;
- создание, удаление или изменение remote Storage buckets/policies/lifecycle;
- изменение DNS, Cloudflare, доменов или Vercel project settings;
- destructive reset, удаление production data/objects или ротация secrets.

Секреты, реальные пароли, private keys и raw IP не выводятся в документацию, логи тестов или отчёты.

## Checkpoints и rollback

После каждой средней/крупной фазы:

1. повторно проверить `git status` и отделить пользовательские изменения;
2. выполнить матрицу проверок этой фазы;
3. обновить Graphify, если граф доступен;
4. обновить реестр, decision log, limitations и changelog;
5. создать локальный result-focused Git checkpoint; не push автоматически.

Rollback выполняется checkpoint-by-checkpoint. Для DB используется новая forward migration, а не переписывание уже применённой history. Storage rollout обязан быть backward-compatible: старый public upload flow не удаляется до проверки нового finalize/reconciliation. Для auth сначала выкатываются совместимые DB RPC, затем app; прежний RPC удаляется только отдельной поздней миграцией. Media derivatives и config включаются обратимо; master не удаляется. Не использовать `git reset --hard` или destructive remote commands для отката.

## Decision log

| Дата | Решение | Причина | Статус |
|---|---|---|---|
| 2026-08-24 | Вести remediation в фазах 0–8 с локальным checkpoint после средней/крупной фазы. | Ограничить blast radius и сделать доказательства проверяемыми. | Принято |
| 2026-08-24 | Product create/update переносить в атомарные Postgres RPC с CAS для update. | Компенсирующие запросы приложения не дают настоящей транзакции. | Принято к реализации |
| 2026-08-24 | Multi-photo create строить как draft + private staged direct upload + server finalize. | Убрать общий multipart payload/CPU bottleneck и сохранить server trust boundary. | Принято к реализации; infra не одобрена |
| 2026-08-24 | Auth использовать строгий reservation до PBKDF2, без per-process fallback. | Blocked traffic не должен расходовать hash budget; serverless memory не security boundary. | Принято к реализации |
| 2026-08-24 | Hero делать poster-first и gated; master сохранять. | Уменьшить initial transfer без деградации источника. | Принято к реализации |
| 2026-08-24 | Accessibility разделить на визуально нейтральную 7A и контролируемую mobile 7B. | Не смешивать исправление поведения с редизайном. | Принято |

## Open questions

1. Каковы фактические production min/max/percentiles для product/category/brand image scale? Без read-only preflight bounds не утверждаются.
2. Какая SVG sanitizer/library корректно работает в текущем server runtime и сохраняет разрешённую vector semantics?
3. Где находится утверждённый high-quality hero master и какие derivatives проходят visual review? Текущие 3/5 MB — только стартовая гипотеза.
4. Какой TTL draft/staging, лимит file size/count и retention отвечают реальному admin workflow?
5. Какой безопасный механизм запуска cleanup/reconciliation доступен в целевой инфраструктуре?
6. Нужен ли `globalNotFound` experimental contract для текущей Next.js patch version или при реализации доступен стабильный эквивалент? Решение принимается по локальной документации установленной версии.
7. Какие exact full-set/subset contracts нужны каждой reorder-сущности, особенно filtered/page product reorder?

## Ограничения среды baseline

- Browser/E2E coverage ещё не создано и не должно считаться существующим.
- Доступность Docker/local Supabase, browser binaries и remote schema в фазе 0 не подтверждалась.
- Production data distributions, remote Storage policies и runtime metrics не измерялись.
- Локальные unit/build результаты предыдущих проверок не заменяют повторную проверку после каждой фазы.
- Remote infrastructure не менялась и не проверялась в фазе 0.

## Порядок релиза

1. Завершить локальные фазы и полный release candidate verification.
2. Получить отдельное разрешение на remote changes и подтвердить backup/rollback owner.
3. Provision private staging bucket, policies и lifecycle в совместимом режиме; старый поток пока сохранить.
4. Применить backward-compatible DB migrations/RPC/grants, проверить migration history, schema, RLS и advisors.
5. Развернуть приложение, совместимое и с новой, и с переходной схемой.
6. Выполнить production smoke: public catalog/search/product/404, admin login, обратимая product mutation, upload/finalize, hero/SEO/a11y; проверить logs/metrics.
7. Наблюдать agreed window и выполнить orphan/rate-limit reconciliation checks.
8. Только отдельным поздним релизом убрать старый upload/RPC contract после доказанного отсутствия обращений и отдельного approval.

## Status changelog

| Дата | Фаза | Изменение | Проверки | Результат |
|---|---:|---|---|---|
| 2026-08-24 | 0 | Documentation contract и independent verification завершены; подготовлены реестр QA-001…QA-012, traceability, зависимости, DoD, полномочия и release order; добавлена ссылка из README. | Tracked `git diff --check`; отдельная whitespace-проверка untracked документа; структура/ID/link target | Фаза 0 завершена после независимой проверки; локальный checkpoint будет создан отдельно; дефекты фаз 1–8 остаются открытыми |
| 2026-08-24 | 1 | Реализован fail-closed local runtime wrapper и Playwright harness: public/admin smoke, изолированные auth/catalog fixtures, responsive/a11y/browser-observer evidence, QA-002…QA-012 regression probes и CI artifacts без auth state. | `npm run check` PASS (69 files/290 tests); scoped ESLint/TypeScript PASS; Playwright list 43, smoke list 12; preflight штатно остановлен из-за недоступного Docker daemon | Implemented, verification pending: QA-001 и остальные QA ID остаются открытыми до полного запуска на поддерживаемом Docker + Chromium окружении |
| 2026-08-25 | 1 | Real smoke прошёл 12/12; prior full result superseded после обнаруженной race между streamed home/loading overlay и responsive assertions. Evidence также зафиксировал P2 density каталога и overlay WhatsApp на 320/390; design fix отложен до фазы 7. | `npm run e2e:smoke` PASS 12/12; полный baseline требует финального rerun после readiness/observer corrections | Implemented, verification pending: фазу 1 не закрывать до успешного полного rerun |
| 2026-08-25 | 1 | Финальный независимый локальный rerun завершён; superseded history выше сохранена. Зафиксированы P2 evidence для density каталога, overlay WhatsApp и большого белого scroll interval; review отложен до фазы 7. | Preflight PASS; production build PASS; smoke 12/12 PASS; full suite exit 0. Всего 43 outcome: 33 ordinary PASS, 5 expected `test.fail` (QA-006/007/008/009/011), 5 `fixme` (QA-002/003/004/005/012), 0 unexpected. Observer, axe, responsive matrix, fixture/auth cleanup, artifact isolation и освобождение 3101 PASS; пользовательский 3001 не затронут. CI не запускался. | Фаза 1 завершена, QA-001 закрыт. Windows Node 24 `UV_HANDLE_CLOSING` и `NO_COLOR`/`FORCE_COLOR` stderr остаются non-blocking P2 при корректном exit/cleanup; QA-002…QA-012 открыты |
| 2026-08-26 | 2 | QA-012 (bounds): read-only измерение production scale-значений; миграция `20260825090000_visual_scale_bounds` с нормализацией и CHECK на трёх колонках; общий `normalizeVisualScale` для UI и сервера; `min`/`max` в трёх инпутах. QA-003: миграция `20260825120000_strict_reorder_contracts` — семь RPC на модели слотов, общий контракт набора, обязательный parent scope для подкатегорий и фотографий, нормализация существующего порядка. QA-002: миграция `20260826090000_atomic_product_mutations` — `create_product_with_relations` / `update_product_with_relations` одной транзакцией, CAS по `expected_updated_at` с `FOR UPDATE`, разрешение slug и порядка внутри транзакции; удалены клиентские `resolveSubcategoryId` и `validateProductReferences`; добавлен `product-rpc-error` для доставки намеренных сообщений админу. Побочно: исправлено расхождение `prod.sql` по `categories.type`; устранена гонка в `assertCriticalControlsInsideViewport` (`count()` не ждал стриминга); тест scope-аргументов сделан устойчивым к CRLF; `.tmp-*/` внесены в оба списка игнорирования. | Полный прогон на восстановленном Docker: `supabase db reset --local` PASS (18 миграций); pgTAP **129/7 файлов PASS** (фаза 2 добавила 53); grants новых RPC проверены отдельно — EXECUTE только у `service_role`, у `anon` и `authenticated` доступа нет; `npm run check` PASS (316 тестов / 73 файла); `git diff --cached --check` PASS; `npm run build` PASS; e2e admin **14/14 PASS**; e2e public 21 PASS / 2 FAIL (внешний блокер, см. итог). Регресс-доказательства: снятие `target_product_slug`, снятие поля версии из формы, подстановка 100/−1/0 и удаление CRLF-нормализации роняют соответствующие проверки, возврат — чинит. Сквозная проверка CAS выполнена через живой supabase-js: подтверждена микросекундная точность версии и форма ошибки конфликта. | QA-002 и QA-003 закрыты; QA-012 закрыт наполовину (bounds), content validation переходит в фазу 3. **Незакрытые внешние ограничения, НЕ являющиеся PASS и не относящиеся к фазе 2:** (1) e2e public — `публичная карточка товара доступна по стабильному route` и `responsive baseline / catalog @ 375x812` падают на `net::ERR_ABORTED`; воспроизведено при отложенных изменениях фазы 2, следовательно принадлежит QA-007 — передано владельцу QA-007, не чинилось; (2) `npm run schema:declarative` FAIL: расхождение целиком по `admin_credentials` и `admin_auth_events_*` (миграция `20260821171707`), объявления этих объектов исключены из checkpoint как чужие — закрывается владельцем QA-007; ни один объект фазы 2 в расхождение не входит. До устранения не запускать `supabase db diff`. Remote миграции не применялись; production изменялся только чтением. |
| 2026-08-26 | 3 | QA-012 (вторая половина, закрывает ID). Вход в фазу выявил дефект серьёзнее заявленного: `uploadBrandLogo` и `uploadCategoryImage` не выполняли **никакой** серверной проверки, расширение бралось из `file.name`, а файл попадал в публичный bucket как есть; логотипы при этом по умолчанию считались SVG. Сделано: общий `validateRasterImage` выделен из `validateProductImage`; добавлен `upload-validation.ts` — тип и расширение выводятся из проверенного содержимого, а не из имени файла (закрыта подмена вида «вредоносный файл с именем photo.jpg»); SVG-логотипы обезвреживаются `isomorphic-dompurify` (профиль svg + явные FORBID_TAGS/FORBID_ATTR) с **отказом**, а не тихой вычисткой; для категорий SVG не принимается (в каталоге его нет); `insertProductImage` также переведён на расширение из содержимого; миграция `20260826150000_storage_upload_limits` задала `file_size_limit` 8 МБ и `allowed_mime_types` трём bucket каталога. Значения по измерению production: крупнейший файл 299 КБ, логотипы ~3 КБ, SVG всего 2. | `npm run check` PASS (330 тестов / 74 файла, +14); pgTAP **138/8 файлов PASS** (+9); `supabase db reset --local` PASS; `npx tsc --noEmit` PASS. Регресс-доказательство: отключение отказа в `sanitizeSvg` роняет 5 из 6 сценариев атак, шестой ловит независимая проверка результата (`residualDanger`) — она добавлена намеренно, чтобы решение не зависело только от внутреннего списка удалённого в библиотеке. Ложное срабатывание на чистом файле (служебный BODY от HTML-обёртки DOMPurify) найдено тестом и исправлено фильтром артефактов разбора. | QA-012 закрыт. QA-004 (staged direct upload, draft/finalize, cleanup по расписанию) остаётся открытым — продолжение фазы 3. Внешние блокеры без изменений: e2e public и расхождение декларативной схемы по `admin_credentials` принадлежат QA-007. Remote миграции не применялись; production изменялся только чтением. |
