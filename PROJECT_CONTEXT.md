# Контекст проекта

> Это исторический снимок исходного состояния проекта, а не источник текущих продуктовых требований. Актуальные решения находятся в `PROJECT_BRIEF.md`, а рабочие правила для ИИ находятся в `CLAUDE.md` и `AGENTS.md`. Упоминания каталога на 5 000–9 000 товаров, запрета WhatsApp и поиска как единственного допустимого способа сужения результатов больше не актуальны.

Дата анализа: 2026-07-24.

Отчёт составлен только по содержимому локального репозитория. Сеть, серверы, тесты, сборка, линтер, миграции и деплой не запускались. Значения переменных окружения не читались и не приводятся.

## 1. Краткое описание

- **Подтверждено:** проект AYPROM — русскоязычный сайт-каталог гидрооборудования и запчастей для тягачей, самосвалов и спецтехники с собственной административной панелью (`PROJECT_BRIEF.md`, `src/app/(site)`, `src/app/admin`).
- **Аудитория:** частные владельцы и небольшие компании, которые используют, ремонтируют, арендуют или обслуживают грузовую и специальную технику (`PROJECT_BRIEF.md`).
- **Решаемая задача:** визуальный просмотр каталога по типу оборудования, бренду и типу техники, текстовый поиск, просмотр карточки товара и контактной информации. Проект намеренно не является интернет-магазином: нет цен, корзины, оплаты и checkout (`PROJECT_BRIEF.md`, `src/components/catalog`).
- **Текущая стадия:** функциональный прототип/ранняя рабочая версия, уже подключённая к Supabase. Реализованы публичный каталог, поиск, детальные страницы и большая часть CRUD-админки. До заявленной готовности к каталогу на 5 000–9 000 товаров не хватает серверной пагинации и backend-поиска; также отсутствуют автоматические тесты, импорт CSV/Excel, управление администраторами и явные route-level error/loading-состояния.
- `README.md` остаётся стандартным текстом create-next-app и не отражает фактическую архитектуру. Более актуальны `PROJECT_BRIEF.md`, `CLAUDE.md` и исходники.

## 2. Технологический стек

| Технология | Версия | Назначение | Подтверждающий файл |
|---|---:|---|---|
| Next.js App Router | 16.2.10 | Маршрутизация, Server Components, Server Actions, ISR, image/font optimization, proxy | `package.json`, `src/app`, `src/proxy.ts` |
| React / React DOM | 19.2.4 | UI, client state, transitions, React `cache()` | `package.json`, `src/components`, `src/lib/queries` |
| TypeScript | `^5` | Строгая типизация исходников | `package.json`, `tsconfig.json` |
| Tailwind CSS | `^4` | Utility-first стили и CSS-токены | `package.json`, `postcss.config.mjs`, `src/app/globals.css` |
| Supabase JS | `^2.110.7` | Доступ к PostgreSQL и Storage | `package.json`, `src/lib/supabase`, `src/lib/queries`, `src/lib/admin/actions.ts` |
| `@supabase/ssr` | `^0.12.3` | Browser client для клиентского breadcrumb | `package.json`, `src/lib/supabase/client.ts` |
| PostgreSQL / Supabase migrations | версия сервера не определена | Каталог, связи, RLS, индексы, Storage buckets | `supabase/migrations/*.sql` |
| Framer Motion | `^12.42.2` | Reveal/stagger-анимации, меню, карусели, микровзаимодействия | `package.json`, `src/components/motion`, `src/components/catalog` |
| dnd-kit | core `^6.3.1`, sortable `^10.0.0`, utilities `^3.2.2` | Drag-and-drop сортировка в админке | `package.json`, `src/components/admin/SortableList.tsx` |
| Lucide React | `^1.24.0` | Иконки | `package.json`, компоненты в `src/components` |
| class-variance-authority | `^0.7.1` | Варианты компонента кнопки | `package.json`, `src/components/ui/Button.tsx` |
| clsx / tailwind-merge | `^2.1.1` / `^3.6.0` | Сборка и разрешение конфликтов CSS-классов | `package.json`, `src/lib/utils.ts` |
| Vercel Speed Insights | `^2.0.0` | Клиентская телеметрия производительности | `package.json`, `src/app/(site)/layout.tsx` |
| ESLint | `^9` + `eslint-config-next` 16.2.10 | Статический анализ | `package.json`, `eslint.config.mjs` |
| npm lockfile | lockfileVersion 3 | Фиксация дерева зависимостей | `package-lock.json` |

Версия runtime Node.js в репозитории не закреплена: поля `engines`, `.nvmrc` или аналогичного файла проекта не обнаружено. `@types/node` версии `^20` не является доказательством версии runtime.

## 3. Структура проекта

```text
.
├─ AGENTS.md                  # обязательное правило читать локальную документацию Next.js перед изменением кода
├─ CLAUDE.md                  # продуктовые и инженерные ограничения
├─ PROJECT_BRIEF.md           # исходное продуктовое задание
├─ README.md                  # стандартный, частично устаревший create-next-app README
├─ package.json               # зависимости и npm scripts
├─ next.config.ts             # Turbopack root и Supabase remote image pattern
├─ tsconfig.json              # strict TypeScript, alias @/* -> src/*
├─ eslint.config.mjs          # Next.js Core Web Vitals + TypeScript lint config
├─ src/
│  ├─ app/
│  │  ├─ (site)/             # публичный root layout и страницы
│  │  ├─ admin/              # независимый admin root layout, login и CRUD-страницы
│  │  └─ globals.css         # Tailwind 4 и дизайн-токены
│  ├─ components/
│  │  ├─ admin/              # формы, списки, drag-and-drop и admin UI
│  │  ├─ catalog/            # поиск, карточка, сетка, галерея и деталь товара
│  │  ├─ home/               # секции главной
│  │  ├─ layout/             # Header, Footer, навигация и scroll helpers
│  │  ├─ motion/             # общие анимационные обёртки
│  │  └─ ui/                 # базовые UI-примитивы
│  ├─ lib/
│  │  ├─ admin/              # Server Actions, admin queries, сессия и client hooks
│  │  ├─ queries/            # публичные read-only Supabase queries
│  │  └─ supabase/           # browser, public server и service-role clients
│  ├─ data/brand-aliases.ts  # дополнительные поисковые алиасы брендов
│  ├─ types/catalog.ts       # доменные интерфейсы
│  └─ proxy.ts               # защита /admin/*
├─ supabase/migrations/      # схема, RLS, seed, Storage и последующие изменения
└─ public/                   # локальные изображения, SVG-логотипы и hero-видео
```

Не анализировались как исходный код: `node_modules`, `.next`, `graphify-out` и прочие генерируемые/служебные каталоги. В `node_modules` не выполнялся поиск реализации проекта.

## 4. Архитектура

### Основные слои

1. **Маршруты и композиция страниц — `src/app`.**
   - `(site)` образует публичный root layout с Header/Footer и общими запросами категорий/типов техники.
   - `admin` — отдельный root layout без публичного chrome.
   - Страницы в основном являются async Server Components.
2. **Представление — `src/components`.**
   - Server Components собирают статические секции и данные.
   - Client Components используются для меню, каруселей, drag-and-drop, форм, оптимистичных изменений и анимаций.
3. **Публичный data access — `src/lib/queries`.**
   - Запросы выполняются publishable-ключом через `src/lib/supabase/server.ts`.
   - Доступ ограничивается RLS; публично видны только опубликованные товары.
4. **Административный слой — `src/lib/admin`.**
   - `actions.ts` содержит все мутации как Server Actions.
   - `queries.ts` читает черновики и usage counts через service-role client.
   - `session.ts` создаёт и проверяет собственный HMAC-cookie.
5. **Хранилище — Supabase PostgreSQL + Supabase Storage.**
   - Схема задаётся SQL-миграциями.
   - Фотографии товаров, логотипы брендов и изображения категорий находятся в публичных Storage buckets.

### Связи и точки входа

- Публичная точка входа: `src/app/(site)/page.tsx`.
- Публичный layout: `src/app/(site)/layout.tsx`.
- Каталог: `src/app/(site)/catalog/page.tsx` и вложенные dynamic routes.
- Админская точка входа `/admin`: `src/app/admin/(protected)/page.tsx`, перенаправляющая на `/admin/products`.
- Вход администратора: `src/app/admin/login/page.tsx` → `login()` в `src/lib/admin/actions.ts`.
- Защита маршрутов: `src/proxy.ts`; защита самих мутаций дублируется `requireAdminSession()`.
- Данные: страницы/секции → `src/lib/queries/*` → публичный Supabase client → RLS → PostgreSQL.
- Мутации: admin client component/form → Server Action → проверка cookie → service-role Supabase client → PostgreSQL/Storage → `revalidatePath`.

### Используемые паттерны

- App Router, route groups и несколько root layouts.
- Server Components по умолчанию, точечные Client Components.
- ISR с `revalidate = 60` на публичных страницах и `revalidate = 0` в админке.
- `React.cache()` для дедупликации одинаковых запросов в пределах рендера.
- Repository/query-like функции без отдельного класса репозитория.
- Server Actions вместо REST/Route Handlers.
- RLS для публичного чтения и service role для административной записи.
- Нормализованная реляционная модель с join-таблицами.
- Оптимистичное локальное состояние для сортировки, удаления и быстрых admin-операций.

## 5. Основные пользовательские сценарии

### Просмотр каталога по категории

Пользователь выбирает карточку на главной → `CategorySection` → `/catalog/category/[slug]` → `getCategory()` и в зависимости от `category.type` `getSubcategories()` либо `getCategoryBrands()` → Supabase/RLS → список подкатегорий или брендов → переход к сетке товаров.

### Просмотр по бренду

Карточка бренда на главной → `/catalog/brand/[slug]` → `getBrandCategories()` → для brand-type категорий используется `category_brands`, для subcategory-type — реальные связи `product_brands` → выбор категории/подкатегории → `getProducts({ brandSlug, ... })` → сетка товаров.

### Просмотр по типу техники

Ссылка в hero или карточка спецтехники → `/catalog/vehicle-type/[slug]` → `getVehicleType()` + `getProducts({ vehicleTypeSlug })` → `product_vehicle_types` → товары разных категорий → `getProductHref()` выбирает канонический category-based URL.

### Поиск

GET-форма в hero или каталоге → query parameter `q` → `ProductGridWithSearch` → `searchProducts()` → объединение имени, артикула, категории, подкатегории, брендов/алиасов и характеристик → AND-поиск по словам в памяти сервера → scoped results; если их нет, выполняется глобальный поиск и блок «Возможно, вы имеете в виду».

### Просмотр товара

Карточка → вложенный URL под подкатегорией или брендом → `getProduct()` + проверка соответствия URL фактическим связям → `ProductDetail` → `ProductGallery`, характеристики, типы техники и совместимые бренды.

### Вход администратора

`/admin/login` → форма с паролем → `login(formData)` → сравнение с `ADMIN_PASSWORD` → HMAC token с expiry → HTTP-only `admin_session` cookie → `/admin/welcome` → переход к `/admin/products`. `src/proxy.ts` защищает все `/admin/*`, кроме login.

### Создание/редактирование товара

Admin form → `createProduct()` или `updateProduct()` → `requireAdminSession()` → разбор `FormData` → запись `products` → связи характеристик, брендов и типов техники → загрузка/запись изображений → revalidation публичного layout и admin pages → redirect с success query parameter → toast/highlight в списке.

### Публикация, удаление и сортировка

Кнопка/drag-and-drop в admin list → оптимистичное client state → отдельная Server Action → service-role update/delete → `revalidatePath`. Для удаления используются browser `confirm()` и usage-count предупреждения.

## 6. Страницы и интерфейс

### Публичные маршруты

- `/` — hero с видео, поиск, категории, типы техники, бренды, кратко о компании, партнёры.
- `/catalog` — все товары и поиск.
- `/catalog/category/[slug]` — выбор подкатегории или бренда в зависимости от типа категории.
- `/catalog/category/[slug]/subcategory/[subSlug]` — товары подкатегории.
- `/catalog/category/[slug]/subcategory/[subSlug]/[productSlug]` — товар subcategory-type категории.
- `/catalog/category/[slug]/brand/[brandSlug]` — товары brand-type категории для бренда.
- `/catalog/category/[slug]/brand/[brandSlug]/[productSlug]` — товар brand-type категории.
- `/catalog/brand/[slug]` — доступные категории бренда.
- `/catalog/brand/[slug]/category/[categorySlug]` — доступные подкатегории бренда.
- `/catalog/brand/[slug]/category/[categorySlug]/subcategory/[subSlug]` — товары бренда в подкатегории.
- `/catalog/vehicle-type/[slug]` — товары для типа техники.
- `/about`, `/contacts`.

Заявленный в `PROJECT_BRIEF.md` простой маршрут `/product/[slug]` не реализован; используются вложенные category-based product routes.

### Административные маршруты

- `/admin/login`, `/admin/welcome`, `/admin` → redirect.
- `/admin/products`, `/admin/products/new`, `/admin/products/[slug]/edit`.
- `/admin/categories`, `/admin/categories/new`, `/admin/categories/[slug]/edit`.
- `/admin/categories/[slug]/subcategories`, `.../new`, `.../[subSlug]/edit`.
- `/admin/categories/[slug]/category-brands`.
- `/admin/brands`, `/admin/brands/new`, `/admin/brands/[slug]/edit`.
- `/admin/vehicle-types`, `/admin/vehicle-types/new`, `/admin/vehicle-types/[slug]/edit`.

`/admin/import` и управление пользователями/сотрудниками отсутствуют.

### Состояния интерфейса

- **Empty:** предусмотрены сообщения для пустого каталога, пустой категории/бренда/подкатегории, пустых admin lists и отсутствия результатов поиска.
- **Success:** admin create/update redirects содержат query parameters; `use-save-flow-flash.ts` показывает toast и подсвечивает строку.
- **Loading:** есть pending labels у submit-кнопок и локальные «Загрузка...» для изображений. Файлы `loading.tsx` не обнаружены.
- **Error:** неизвестные сущности вызывают `notFound()`, но собственных `error.tsx` и `not-found.tsx` нет. Ошибки Supabase преимущественно выбрасываются; специального пользовательского error UI и отката оптимистичных операций нет.

### Адаптивность, доступность и дизайн

- Основные сетки адаптируются через Tailwind breakpoints; Header имеет отдельное мобильное меню, admin nav переносится на узких экранах.
- У интерактивных иконок и каруселей есть `aria-label`, видимые focus rings и увеличенные touch targets. `Reveal`, `Stagger` и несколько карточек учитывают `prefers-reduced-motion`.
- Поля admin forms связаны с label через общие компоненты.
- Поисковые поля в `Hero.tsx` и `ProductSearchForm.tsx` полагаются только на placeholder и не имеют отдельного label/`aria-label`.
- Hero-видео autoplay/muted/loop не имеет poster и отдельной обработки reduced motion/data.
- Дизайн-система локальная: Tailwind 4, Geist, семантические токены `primary`, `accent`, `muted`, `border`, `card`, `ring` и фиксированный brand navy в `src/app/globals.css`.
- Стиль — бело-синий, минималистичный, индустриальный. UI-kit внешнего поставщика не используется; базовые компоненты находятся в `src/components/ui` и `src/components/admin/ui`.

## 7. Данные и состояние

### Основные сущности

- `Category`: slug, название, описание, иконка, изображение, intro, `type = subcategory | brand`.
- `Subcategory`: UUID в БД, scoped slug, название, изображение, intro, порядок.
- `Brand`: slug, название, страна, логотип, visual scale, порядок.
- `VehicleType`: slug, название, порядок.
- `Product`: UUID в БД, slug, название, category, optional subcategory, описания, артикул, published, порядок, timestamps.
- `ProductImage`: URL, порядок, optional visual scale.
- `ProductCharacteristic`: свободная пара attribute/value с порядком.
- Join-таблицы: `product_brands`, `product_vehicle_types`, `category_brands`.

Типы публичного домена находятся в `src/types/catalog.ts`; admin-specific формы данных — в `src/lib/admin/queries.ts`.

### Хранение и состояние

- Постоянные данные: Supabase PostgreSQL.
- Файлы: публичные Supabase Storage buckets `product-images`, `brand-logos`, `category-images`.
- Публичные страницы: server-fetched data + ISR cache 60 секунд.
- Локальное состояние: React `useState` в каруселях, меню и admin forms.
- URL state: `q`, `category`, `created`, `updated` в query parameters.
- Auth state: HTTP-only cookie `admin_session`, срок 1 день.
- Статические визуальные настройки типов техники остаются в `VehicleShowcaseSection.tsx`, а поисковые алиасы — в `src/data/brand-aliases.ts`.

### Валидация

- БД: PK, FK, unique, not-null, check для `categories.type`, RLS.
- Server Actions: trim строк, обязательность ключевых полей, slugify и попытка уникального slug.
- Browser: `required`, `accept="image/*"`, client-side image compression.
- Не подтверждена server-side проверка MIME type, размера и содержимого загружаемых файлов.
- `resolveSubcategoryId()` возвращает `null`, если переданный slug не существует; принадлежность subcategory к типу категории отдельно не закреплена check constraint.

### Кэширование

- `revalidate = 60` у публичного layout/pages.
- `revalidatePath("/", "layout")` после admin mutations.
- `React.cache()` для части запросов сущности по slug и общих списков.
- Отдельного CDN/application cache или клиентского query cache не обнаружено.

### Важные связи

- Category 1→N Subcategory; удаление category каскадно удаляет subcategories.
- Category 1→N Product без cascade: category с товарами удалить нельзя.
- Subcategory 1→N Product без cascade: используемую subcategory удалить нельзя.
- Product 1→N images/characteristics с cascade.
- Product N↔M Brand и Product N↔M VehicleType с cascade на join rows.
- Category N↔M Brand через `category_brands`; используется только для brand-type навигации.

## 8. API и интеграции

### Внутренний API

- `route.ts`/Route Handlers не обнаружены.
- Внутренние мутации реализованы Next.js Server Actions в `src/lib/admin/actions.ts`.
- Публичные чтения выполняются непосредственно из Server Components/queries в Supabase.
- `Breadcrumb.tsx` — единственный подтверждённый browser-side Supabase reader.

### Внешние сервисы

- Supabase PostgreSQL/Data API.
- Supabase Storage с публичными URL.
- Vercel Speed Insights.
- В интерфейсе есть обычные внешние ссылки на социальные сети; это не программная интеграция.
- Webhooks, cron, очереди и фоновые задачи не обнаружены.

### Авторизация и права

- Публичный client использует publishable key; RLS разрешает чтение справочников и только опубликованных товаров/дочерних данных.
- Admin client использует `SUPABASE_SECRET_KEY` и обходит RLS; он импортируется из admin-кода.
- Админ-аутентификация собственная, не Supabase Auth: один пароль из окружения + HMAC-signed cookie.
- Proxy закрывает admin routes, а каждая mutation повторно вызывает `requireAdminSession()`.

### Обработка ошибок

- Запросы и действия в основном делают `throw error`.
- Несуществующие public/admin records приводят к `notFound()`.
- Неверный пароль приводит к redirect `/admin/login?error=1`.
- Нет общего пользовательского error boundary, retry UI или централизованного логирования.
- Несколько Storage и reorder-вызовов не проверяют возвращённый `error`, поэтому сбои могут остаться незамеченными.

## 9. Конфигурация и окружение

### Требуемые инструменты

- Node.js и npm; точная версия Node.js не зафиксирована.
- Проект Supabase с применёнными миграциями и созданными Storage buckets.
- Для production предполагается среда, способная запускать Next.js 16 и Server Actions.

### Названия переменных окружения

Из `.env.local` были извлечены только имена слева от `=`; значения не читались и не копировались:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`

### Важные файлы

- `next.config.ts`: Turbopack root; разрешает `next/image` для hostname из `NEXT_PUBLIC_SUPABASE_URL`.
- `tsconfig.json`: `strict`, `noEmit`, bundler resolution, alias `@/*`.
- `eslint.config.mjs`: Next Core Web Vitals и TypeScript.
- `postcss.config.mjs`: Tailwind 4 PostCSS plugin.
- `.gitignore`: исключает `.env*`, `.vercel`, build outputs, agent/graphify outputs.
- `supabase/migrations/*.sql`: схема и инфраструктура данных.

`next.config.ts` создаёт `new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!)` при загрузке конфигурации; отсутствие или неверный формат переменной может остановить dev/build до запуска приложения.

### Development и production

- Dev script запускает Next.js на порту 3001.
- Session cookie получает `secure: true` только при `NODE_ENV === "production"`.
- Публичные страницы ISR-кэшируются; admin pages имеют `revalidate = 0`.
- Иных явно описанных различий окружений не обнаружено.

## 10. Команды проекта

Подтверждено `package.json` и наличием `package-lock.json`:

| Задача | Команда | Статус |
|---|---|---|
| Установка воспроизводимого дерева | `npm ci` | стандартная npm-команда, подтверждена lockfile |
| Обычная установка | `npm install` | стандартная npm-команда, подтверждена npm manifest/lockfile |
| Разработка | `npm run dev` | `next dev -p 3001` |
| Сборка | `npm run build` | `next build` |
| Production server | `npm run start` | `next start` |
| Линтинг | `npm run lint` | `eslint` |
| Тесты | отсутствует | script не определён |
| Проверка типов | отсутствует | отдельный script не определён; `tsconfig.json` содержит `noEmit`, но команду придумывать нельзя |
| Деплой | отсутствует | script не определён |

Ни одна из этих команд в рамках анализа не запускалась.

## 11. Тестирование

- Файлы с типичными именами `*.test.*` и `*.spec.*` не обнаружены.
- Test runner и test script в `package.json` отсутствуют.
- Автоматического покрытия публичной навигации, поиска, RLS, auth, CRUD, загрузки файлов, сортировки и error states нет.
- Особо важные непокрытые сценарии: товар без изображения; частичный сбой multi-step CRUD; неуспешная оптимистичная mutation; неправильные category/subcategory/brand связи; brute-force login; работа на объёме 5 000–9 000 товаров.
- Тесты в рамках анализа **не запускались**.

## 12. Деплой

- **Предположение с сильными признаками:** целевая платформа — Vercel. Это поддерживают раздел README, наличие локального `.vercel`, пакет `@vercel/speed-insights` и стандартная Next.js архитектура.
- Подтверждённый build command — `npm run build`; отдельного publish/deploy script нет.
- Инфраструктурные зависимости: Supabase project, применённые SQL migrations, три Storage buckets и пять переменных окружения.
- При build/prerender необходим доступ к Supabase для страниц, вызывающих `generateStaticParams()` и data queries.
- Ничего не собиралось, не публиковалось и не изменялось во внешней инфраструктуре.

## 13. Соглашения проекта

- TypeScript strict, alias imports `@/...`, функциональные React-компоненты.
- Компоненты разнесены по предметным каталогам; повторяющиеся UI-элементы вынесены в `components/ui` и `components/admin/ui`.
- Slug-и kebab-case; файлы компонентов PascalCase; функции/хуки camelCase.
- Публичные запросы и admin queries разделены по уровню полномочий.
- Ошибки Supabase обычно не преобразуются, а пробрасываются.
- Комментарии в коде подробно объясняют причины архитектурных решений.
- `CLAUDE.md`: Next.js App Router, TypeScript, Tailwind, reusable components, mobile/tablet/desktop, бело-синяя палитра, без ecommerce/цен/WhatsApp/AI-search; изначально mock-first, затем backend pagination/search.
- `PROJECT_BRIEF.md`: homepage должна быть компактной; поиск — единственный механизм сужения каталога; целевой размер 5 000–9 000 товаров.
- `AGENTS.md`: перед любым написанием кода обязательно прочитать релевантное руководство именно установленной версии в `node_modules/next/dist/docs/`; нельзя полагаться на прежние знания о Next.js и нужно учитывать deprecations.
- `README.md` содержит устаревшее указание редактировать `app/page.tsx`; фактический путь — `src/app/(site)/page.tsx`.

## 14. Текущее состояние

### Реализовано

- Публичная главная, about и contacts.
- Каталог по категориям, подкатегориям, брендам и типам техники.
- Plain search по нескольким полям и brand aliases.
- Карточки и галереи с swipe/arrows/dots.
- Supabase schema, RLS, seed и Storage buckets.
- Admin login, CRUD товаров/категорий/подкатегорий/брендов/типов техники.
- Публикация/снятие с публикации, ordering, image upload/replace/delete/scale.
- ISR и принудительная revalidation после mutations.
- Responsive layouts и значительная часть keyboard/focus/touch affordances.

### Не завершено или отсутствует

- Серверная пагинация и backend search.
- CSV/Excel import.
- Управление admin users/employees; используется один общий пароль.
- Similar products на product page.
- Явный `/product/[slug]` из brief.
- Route-level `loading.tsx`, `error.tsx`, custom `not-found.tsx`.
- Автоматические тесты и typecheck script.
- Отдельные API endpoints, webhooks и background jobs.
- Подтверждённый production runbook/deploy script.

### Заглушки и mock-данные

- `supabase/migrations/0004_seed_mock_data.sql` создаёт 12 намеренно неполных тестовых товаров AY-GP110…AY-GP121 и повторяет одну placeholder-фотографию.
- `PartnersSection.tsx` содержит статические placeholder-названия партнёров.
- Визуальные изображения и геометрия четырёх типов техники жёстко заданы в `VehicleShowcaseSection.tsx`, а не управляются из БД.
- Контент контактов и about захардкожен в компонентах.

### TODO/FIXME и технический долг

- Маркеры TODO/FIXME/HACK/XXX в собственном коде не найдены.
- Отсутствие маркеров не означает отсутствие долга: ключевые ограничения перечислены выше и в разделе рисков.
- В миграциях есть номера `0005`, затем `0007`; комментарий `0005_storage.sql` ссылается на `0006_storage_no_listing.sql`, которого в репозитории нет. По текущему SQL политика listing действительно не создаётся, но историю отсутствующего файла достоверно определить нельзя.

## 15. Риски

Ниже только наблюдения; код не исправлялся.

### Возможные баги

- **Товар без фото:** admin form разрешает создать товар без изображений, но `ProductCard.tsx` и `ProductGallery.tsx` без проверки обращаются к `images[0].url`. Такой опубликованный товар способен вызвать runtime error.
- **Частичные записи:** create/update товара и связей выполняются несколькими независимыми запросами без транзакции. Ошибка после создания основной строки может оставить неполный товар; delete+insert при update может потерять часть связей.
- **Storage до DB delete:** удаление файлов часто происходит до удаления строки. Если удаление строки затем не удастся, запись останется с уже удалённым изображением.
- **Orphan files:** бренд/категория/подкатегория сначала загружает файл, затем создаёт строку. Ошибка insert оставляет объект в Storage.
- **Необработанные ошибки сортировки:** `Promise.all` ждёт Supabase update promises, но ряд reorder-функций не проверяет поле `error` результата.
- **Optimistic UI без rollback:** списки и category-brand manager сразу меняют локальное состояние, но не показывают ошибку и не возвращают состояние при сбое Server Action.
- **Неполная data invariant:** тип `Product` заявляет минимум одно изображение только в комментарии; БД и Server Action этого не требуют.

### Безопасность

- Один общий пароль, нет пользователей, ролей, rate limiting, lockout или MFA. `/admin/login` потенциально подвержен перебору пароля.
- Сравнение пароля выполняется обычным `!==`; пароль хранится как один env secret, а не как password hash/user record.
- Server Actions корректно повторно проверяют HMAC-сессию, cookie HTTP-only/SameSite=Lax, service-role client отделён от публичного — это положительные меры.
- Server-side upload validation MIME/size/content не обнаружена; `accept="image/*"` и compression работают только на клиенте и обходятся прямым вызовом action.
- Storage buckets публичные по дизайну. Доступ на запись ограничен service role, но случайно загруженный чувствительный файл будет публично доступен по URL.
- `.env*` игнорируется Git; значения секретов в ходе анализа не раскрывались.

### Производительность

- `getProducts()` без limit/range загружает все товары вместе со всеми изображениями, характеристиками, брендами и типами техники.
- Поиск выполняется в памяти сервера и дополнительно загружает все категории, подкатегории и бренды; fallback может повторно загрузить весь каталог.
- Это прямо конфликтует с целевыми 5 000–9 000 товаров и требованием backend pagination/search.
- Brand/vehicle filtering сначала получает список всех совпавших slug, затем делает `.in(...)`; большие списки могут упереться в размер запроса.
- Hero использует preload/autoplay полноэкранного MP4 без poster и без адаптации по соединению.
- Breadcrumb делает дополнительные client-side Supabase requests после hydration.

### UX/UI

- Нет пользовательского error UI/retry для недоступного Supabase; падение запроса уйдёт в стандартную ошибку Next.js.
- Поисковые поля не имеют постоянной доступной метки.
- Admin optimistic actions могут визуально сообщить успех до фактического подтверждения.
- На публичных списках отсутствуют пагинация и счётчик результатов.
- Missing image не имеет placeholder fallback.
- Placeholder-партнёры могут восприниматься как реальные, если версия будет опубликована без замены.

### Поддерживаемость

- `src/lib/admin/actions.ts` превышает 1 000 строк и объединяет auth, products, files, brands, categories, subcategories и vehicle types.
- Многошаговые бизнес-операции находятся на уровне приложения, а не в транзакционных DB functions.
- Доменные invariants частично описаны комментариями, но не закреплены schema constraints/types.
- Статические vehicle visuals требуют синхронизации slug БД и кода.
- README не обновлён под реальный проект.
- Отсутствуют тесты, CI-конфигурация и явный typecheck script.

## 16. Карта ключевых файлов

| Файл | Назначение | От чего зависит | Что зависит от него | Почему важен |
|---|---|---|---|---|
| `src/app/(site)/layout.tsx` | Публичный root layout, metadata, Header/Footer | Next, queries, Speed Insights | Все публичные страницы | Общая оболочка и общие данные |
| `src/app/(site)/page.tsx` | Главная | Home/site sections, vehicle query | `/` | Главная навигационная витрина |
| `src/app/(site)/catalog/page.tsx` | Общий каталог и поиск | product queries, search grid, href mapper | `/catalog` | Основной entry point каталога |
| `src/app/admin/(protected)/layout.tsx` | Оболочка защищённой админки | admin nav, logout | Все protected admin pages | Разделяет admin/public UI |
| `src/proxy.ts` | Route guard для `/admin/*` | session verifier, NextRequest | Admin routes | Первая линия auth |
| `src/lib/admin/session.ts` | HMAC token и expiry | Web Crypto, env | proxy, admin actions | Основа собственной auth-сессии |
| `src/lib/admin/actions.ts` | Все административные мутации | cookies, service-role client, Storage, revalidation | Admin forms/lists | Центральная бизнес-логика записи |
| `src/lib/admin/queries.ts` | Admin reads и usage counts | service-role client | Admin pages/forms/lists | Видит drafts и готовит CRUD UI |
| `src/lib/queries/products.ts` | Публичное чтение/маппинг товаров | public Supabase client | Catalog pages, detail, search | Главный read path и главный scaling bottleneck |
| `src/lib/search-products.ts` | Plain multi-field search | категории, подкатегории, бренды, aliases | `ProductGridWithSearch` | Реализует ключевой сценарий v1 |
| `src/lib/product-href.ts` | Канонический URL товара | Product и category-brand lookup | Общий каталог, vehicle pages, fallback | Связывает две модели маршрутов |
| `src/components/catalog/ProductCard.tsx` | Карточка и мини-карусель | Next Image/Link, Framer Motion | Все product grids | Ключевой public UI; хрупок при пустых images |
| `src/components/catalog/ProductGallery.tsx` | Галерея товара | Next Image, Framer Motion | `ProductDetail` | Также предполагает минимум одно фото |
| `src/components/admin/ProductForm.tsx` | Полный create/edit товара | Server Actions, compression, DnD | Product admin pages | Самая сложная форма и источник data flows |
| `src/types/catalog.ts` | Публичные доменные типы | React types | Queries и UI | Контракт между данными и представлением |
| `src/lib/supabase/server.ts` | Публичный server client | publishable env vars | Public queries | Сохраняет RLS и ISR eligibility |
| `src/lib/supabase/admin.ts` | Service-role client | secret env var | Admin actions/queries | Максимальные права; критичная граница безопасности |
| `supabase/migrations/0001_init.sql` | Базовая схема/RLS/индексы | Supabase PostgreSQL | Все data paths | Источник базовой модели данных |
| `supabase/migrations/0010_vehicle_types.sql` | Типы техники и join table | Базовая products schema | Vehicle queries/admin/routes | Добавляет текущую cross-category классификацию |
| `next.config.ts` | Next/Turbopack/images config | `NEXT_PUBLIC_SUPABASE_URL` | Dev/build/runtime image behavior | Может остановить запуск при неверном env |
| `src/app/globals.css` | Tailwind theme и токены | Tailwind 4 | Практически весь UI | Источник визуальных констант |

## 17. Рекомендации следующему AI-ассистенту

### Читать первыми

1. `AGENTS.md`, затем релевантные документы установленного Next.js из `node_modules/next/dist/docs/` **до написания кода**.
2. `CLAUDE.md` и `PROJECT_BRIEF.md`.
3. `package.json`, `next.config.ts`, `tsconfig.json`.
4. `src/types/catalog.ts` и все `supabase/migrations/*.sql`.
5. Для public-задач: `src/lib/queries/*`, `src/lib/search-products.ts`, нужный route и components.
6. Для admin-задач: `src/proxy.ts`, `src/lib/admin/session.ts`, соответствующие части `actions.ts`/`queries.ts` и форму/список.

### Проверять перед изменениями

- Сначала `git status --short` и `git diff -- <целевые файлы>`: на момент этого отчёта уже существуют пользовательские изменения.
- Уточнять фактический Next.js 16 API по локальной документации, не по памяти.
- Проверять RLS, FK/cascade и порядок Storage/DB операций.
- Проверять оба вида category navigation: `type="subcategory"` и `type="brand"`.
- Проверять все места, где товар может не иметь subcategory, brand или image.
- Проверять revalidation public layout после каждой mutation.
- Не выводить значения `.env.local`; service-role secret не должен попадать в client imports.

### Особенно хрупкие части

- `src/lib/admin/actions.ts`: многошаговые нетранзакционные операции и работа со Storage.
- `ProductCard.tsx`/`ProductGallery.tsx`: предположение о непустом `images`.
- `getProducts()`/`searchProducts()`: масштабирование и полнота embedded data.
- `getProductHref()`: выбор URL зависит от согласованности category type, subcategory и brand links.
- `Breadcrumb.tsx`: client-side запросы и ручной разбор сегментов.
- `next.config.ts`: обязательный валидный Supabase URL уже при загрузке config.

### Безопасные команды анализа

- `git status --short`
- `git diff -- <конкретный путь>`
- `rg --files` с исключением generated directories
- `rg -n <pattern> src supabase`
- `Get-Content -LiteralPath <конкретный файл>`
- `Get-ChildItem` для списка файлов

`npm run lint` не содержит `--fix` и выглядит не модифицирующим исходники, но в рамках данного анализа не запускался; следующему ассистенту следует запускать проверки только после разрешения и после фиксации исходного статуса. Не запускать migrations, dev server, deploy или dependency install без отдельного разрешения.

### Нельзя предполагать без проверки

- Что README актуален.
- Что проект всё ещё использует только mock data.
- Что каждый товар имеет фото, subcategory или совместимый brand.
- Что поиск и каталог уже готовы к тысячам товаров.
- Что любой category slug однозначно задаёт модель навигации: источник истины — `categories.type`.
- Что mutation атомарна или оптимистичное состояние подтверждено сервером.
- Что `.vercel` означает подтверждённый production deploy.

## 18. Неясности

- Точная версия Node.js и поддерживаемый package manager policy.
- Был ли проект уже опубликован и какой production URL используется.
- Текущее состояние удалённого Supabase: применены ли все локальные миграции и совпадает ли schema.
- Почему отсутствует упомянутый в комментарии migration `0006_storage_no_listing.sql`.
- Являются ли текущие партнёры реальными или только визуальными placeholder; код указывает на placeholder-направление.
- Должен ли `/product/[slug]` заменить вложенные URL или brief устарел.
- Требования к rate limiting, нескольким администраторам, ролям, audit log и восстановлению пароля.
- Ограничения размера/формата загрузок и политика очистки orphan Storage objects.
- Требования к SEO beyond metadata: sitemap/robots route-файлы не обнаружены.
- Планируемый backend search engine/стратегия пагинации.
- Требуется ли сохранять fallback-глобальный поиск при переходе на backend search.
- Наличие CI/CD вне репозитория.
- Принадлежность уже существующих незакоммиченных изменений и их готовность не определялась; они сохранены без вмешательства.

## 19. Проверка целостности

### `git status --short` до анализа

```text
 M src/app/globals.css
 M src/components/admin/WelcomeSplash.tsx
 M src/components/layout/Footer.tsx
 M src/components/layout/Header.tsx
 M src/components/site/AboutPreview.tsx
?? public/brand/
```

Это были уже существовавшие пользовательские изменения до создания отчёта. Они не изменялись и не отменялись.

### `git status --short` после анализа

Ожидаемый и затем проверяемый итог:

```text
 M src/app/globals.css
 M src/components/admin/WelcomeSplash.tsx
 M src/components/layout/Footer.tsx
 M src/components/layout/Header.tsx
 M src/components/site/AboutPreview.tsx
?? PROJECT_CONTEXT.md
?? public/brand/
```

Буквальное требование получить только `?? PROJECT_CONTEXT.md` несовместимо с исходным статусом: для этого пришлось бы удалить или откатить пользовательские изменения, что запрещено. Единственное изменение, внесённое в ходе анализа, — создание `PROJECT_CONTEXT.md`.

### Выполненные команды и операции

- `git status --short` — фиксация состояния.
- `Get-ChildItem` — чтение структуры и имён файлов.
- `rg --files` — инвентаризация исходников, маршрутов, тестов и инструкций.
- `rg -n` — поиск exports, CRUD-вызовов, TODO/FIXME, route handlers и интеграций.
- `Get-Content -LiteralPath` — чтение конкретных инструкций, конфигурации, исходников и SQL.
- Безопасное извлечение только имён переменных окружения слева от `=`; значения не выводились.
- `apply_patch` — создание только `PROJECT_CONTEXT.md`.

Первый read-only shell-вызов не запустился из-за отсутствующего sandbox helper; затем те же read-only проверки были выполнены с разрешением вне неисправного sandbox. Сеть при этом не использовалась.

### Подтверждения

- Существующие исходники, lock-файлы, `.git`, БД и системная конфигурация не изменялись.
- Значения секретов, токенов, cookies и credentials не читались и не копировались.
- Зависимости не устанавливались и не обновлялись.
- Тесты, линтер, typecheck и build не запускались.
- Dev/production servers не запускались.
- Миграции, генераторы, форматтеры и команды деплоя не запускались.
- Внешние сервисы не вызывались, данные наружу не отправлялись.
