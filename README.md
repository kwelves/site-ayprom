# AYPROM — каталог гидрооборудования

Русскоязычный сайт-каталог гидрооборудования и запчастей для грузовой и специальной техники. В проект входят публичный каталог с поиском и карточками товаров, а также защищённая административная панель для управления товарами, категориями, брендами и типами техники.

Это не интернет-магазин: в проекте нет цен, корзины, оплаты и checkout.

## Требования

- Node.js 24.17.0 — версия закреплена в `.nvmrc`;
- npm 10 или новее;
- доступ к проекту Supabase;
- для локальной проверки полного цикла Supabase CLI и Docker-совместимый runtime.

Next.js 16.2.11 требует Node.js не ниже 20.9. Репозиторий дополнительно ограничивает поддерживаемый диапазон в `package.json`.

## Локальный запуск

```bash
nvm use
npm ci
copy .env.example .env.local
npm run dev
```

На macOS/Linux вместо `copy`:

```bash
cp .env.example .env.local
```

После заполнения `.env.local` сайт доступен по адресу [http://localhost:3001](http://localhost:3001). Административная панель находится на `/admin`.

Не коммитьте `.env.local`: все `.env*`, кроме безопасного шаблона `.env.example`, исключены из Git.

## Переменные окружения

| Переменная | Где используется | Секрет |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL проекта Supabase, публичные и серверные запросы | нет |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | публичное чтение через RLS | нет |
| `NEXT_PUBLIC_SITE_URL` | канонический origin сайта без завершающего `/` | нет |
| `SUPABASE_SECRET_KEY` | административные Server Actions и проверка схемы | да |
| `ADMIN_PASSWORD` | текущий общий пароль входа в админку | да |
| `ADMIN_SESSION_SECRET` | HMAC-подпись административной cookie; используйте минимум 32 случайных байта | да |

`SUPABASE_SECRET_KEY`, `ADMIN_PASSWORD` и `ADMIN_SESSION_SECRET` разрешено читать только серверному коду. Не добавляйте к ним префикс `NEXT_PUBLIC_`.

## Команды

```bash
npm run dev          # development-сервер на порту 3001
npm run lint         # ESLint
npm run typecheck    # TypeScript без генерации файлов
npm run test         # unit-тесты Vitest
npm run check        # безопасная общая проверка: lint + typecheck + unit-тесты
npm run build        # production-сборка
npm run start        # запуск production-сборки
npm run e2e:preflight # local Supabase/Docker/Chromium без вывода секретов
npm run e2e:smoke     # production build + критические browser smoke
npm run e2e           # полный Playwright baseline/regression suite
npm run schema:check # read-only сверка миграций с удалённым Supabase
```

`schema:check` не меняет БД. Команда сравнивает таблицы и колонки `public`, описанные в `supabase/migrations`, с OpenAPI-схемой PostgREST и проверяет наличие/публичность Storage buckets. Для неё нужен заполненный `.env.local` и сетевой доступ.

## Browser E2E

Playwright всегда тестирует production-сборку на отдельном `http://127.0.0.1:3101` и управляемый Chromium с изолированным browser context. Порт задаётся через `E2E_PORT`, но `3001` намеренно запрещён, чтобы harness не конфликтовал с запущенным пользовательским `npm run dev`. Чужой сервер не переиспользуется и не останавливается. Перед первым запуском установите браузер и поднимите локальный Supabase:

```bash
npm run e2e:install
supabase start
npm run e2e:preflight
npm run e2e:smoke
```

`e2e`, `e2e:smoke`, `e2e:public` и `e2e:admin` сами выполняют `next build`; `e2e:ci` предназначена только для CI, где production build уже завершён отдельным шагом. Wrapper получает runtime-значения через `supabase status`, поверх любых Supabase-переменных из `.env.local`, и прекращает запуск, если URL не локальный. Для входа и rate-limit key он задаёт отдельные throwaway E2E password/session secret. Admin E2E требует отсутствия `admin_credentials.primary` и использует env fallback; существующая credential никогда не изменяется, а вызывает понятный fail-closed отказ. Public project не зависит от auth setup и не меняет auth state. Remote/production Supabase для E2E не поддерживается.

Тестовые категории и товары имеют префикс `qa-e2e-`; каждый сценарий хранит собственные slug/ID и очищает только принадлежащие ему записи в изолированном lifecycle. Admin CRUD создаёт собственную категорию и не зависит от seed/public fixtures; фото не загружаются. Raw `storageState` админки живёт отдельно в игнорируемой `.playwright-state/`, удаляется teardown-проектом и не входит в CI artifacts. Trace для auth/admin projects отключён; failure evidence public-тестов всё ещё может содержать эфемерные локальные test-session/fixture данные и хранится только по CI artifact policy — 14 дней. HTML-report, video, screenshots и responsive evidence сохраняются в `playwright-report/` и `test-results/artifacts/`. В CI Chromium устанавливается с системными зависимостями, а разрешённые каталоги артефактов загружаются даже при падении тестов. Playwright запускает Next как непосредственно управляемый child process на 3101; дополнительный Windows wrapper не используется. Финальный локальный полный запуск завершился с exit 0 и освободил 3101; пользовательский 3001 не затрагивался. Windows Node 24 при shutdown всё ещё выводит non-blocking `UV_HANDLE_CLOSING` и `NO_COLOR`/`FORCE_COLOR` stderr; они не подавляются, пока exit и cleanup корректны. `reuseExistingServer` выключен.

Финальная независимая локальная verification: preflight и production build PASS, smoke 12/12 PASS, полный набор — 43 outcome без unexpected results: 33 ordinary PASS, 5 ожидаемых `test.fail` для QA-006/007/008/009/011 и 5 `fixme` для QA-002/003/004/005/012. Это локальная проверка, не результат запуска GitHub Actions CI.

Viewport baseline: `320x800`, `375x812`, `390x844`, `768x1024`, `1440x1000`. Это evidence, а не pixel-perfect snapshot gate. Каждый required control проверяется отдельно: zero-match, clipping и overlap считаются ошибками. Browser observer по умолчанию считает ошибкой неожиданные `console.warning/error`, `pageerror`, любой failed request и любой HTTP 4xx/5xx. Встроенные исключения узкие и local-only: доказанный same-origin Next prefetch GET abort и точный `/_vercel/speed-insights/script.js` 404 с соответствующим console event. Document 404 и Server Action POST abort разрешаются только per-test predicate с точными origin/path/method/resource type/Next headers; произвольные 4xx и `ERR_ABORTED` не игнорируются. Axe блокирует serious/critical нарушения.

## Архитектура

```text
src/
├─ app/
│  ├─ (site)/           публичные страницы и публичный layout
│  └─ admin/            login и защищённые страницы админки
├─ components/
│  ├─ catalog/          карточки, поиск, галерея и страница товара
│  ├─ admin/            формы, списки и drag-and-drop
│  ├─ home/             секции главной
│  └─ ui/               общие UI-компоненты
├─ lib/
│  ├─ queries/          публичные read-only запросы к Supabase
│  ├─ admin/            административные запросы, Server Actions и сессия
│  └─ supabase/         публичный read-only и серверный service-role клиенты
├─ types/               доменные типы каталога
└─ proxy.ts             защита административных маршрутов

supabase/migrations/    последовательная SQL-схема, RLS, grants и Storage
scripts/                безопасные диагностические команды
public/                 статические изображения, логотипы и hero-видео
```

Публичные страницы — преимущественно async Server Components. Они читают данные publishable-ключом и ограничены RLS. Административные мутации выполняются Server Actions после обязательной проверки HMAC-сессии; только этот серверный слой импортирует service-role клиент.

## Ротация секретов

1. Создайте новый секрет в провайдере, не удаляя старый до успешного развёртывания.
2. Обновите соответствующую переменную окружения во всех средах и выполните production-сборку.
3. Проверьте вход, чтение каталога и одну обратимую административную операцию.
4. Отзовите старый ключ у провайдера и повторите проверку.

Смена `ADMIN_SESSION_SECRET` немедленно инвалидирует все административные cookie. При смене `SUPABASE_SECRET_KEY` сначала обновите deployment, затем отзовите прежний service-role/secret key в Supabase. Значения секретов нельзя помещать в issue, CI-логи или сообщения об ошибках.

## Supabase и миграции

Структура базы описывается декларативно в `supabase/schemas/`. Это источник истины: правится желаемое состояние, а миграция генерируется из него.

```bash
supabase db diff -f имя_изменения   # сгенерировать миграцию из правок в schemas/
supabase db reset                    # применить с нуля и наполнить сидами
```

В `supabase/migrations` лежит baseline и всё, что сгенерировано после него. Прежние миграции сохранены в `supabase/migrations/_archive` — они уже свёрнуты в baseline и не применяются.

Диф не покрывает вставки данных (включая Storage buckets), привилегии схемы и колонок, комментарии и `alter policy` — такие изменения пишутся миграцией вручную через `supabase migration new`.

Данные для локальной разработки живут в `supabase/seed.sql` и применяются только при `db reset`; на удалённый проект сиды не попадают.

Безопасный цикл:

```bash
npx supabase --help
npx supabase start
npx supabase db reset
npm run schema:check
npx supabase db advisors --local
```

Не запускайте `supabase db reset --linked` для production: эта команда удаляет удалённые данные. Перед `db push` просмотрите миграцию и выполните `supabase db push --dry-run`.

После применения миграций повторите `npm run schema:check`. Ненулевой код выхода означает, что приложение и удалённая схема ещё не синхронизированы; это нельзя игнорировать при релизе.

Текущая схема содержит сущности категорий, подкатегорий, брендов, товаров, изображений, характеристик и типов техники. Публичные роли получают только чтение, а административная запись выполняется service role. Storage buckets `product-images`, `brand-logos` и `category-images` публичны только для выдачи изображений; загрузка и удаление выполняются сервером.

## Performance budgets

- LCP: не более 2,5 с на 75-м перцентиле мобильных визитов;
- CLS: не более 0,1;
- INP: не более 200 мс;
- ответ каталога и поиска: p95 не более 1 с на целевом наборе из 2 000 товаров;
- одна страница каталога: не более 24 карточек и только одно изображение на карточку;
- hero-видео: 2K (2560×1440 desktop / 1440×2560 mobile), кодирование по
  качеству (CRF, не фиксированным битрейтом — см. `scripts/generate-hero-video.mjs`);
  обе версии должны сохранять бесшовный цикл, H.264 web-совместимость и
  загрузку через соответствующий media source.

После релиза контролируйте Web Vitals через Vercel Speed Insights. Целевой объём каталога составляет около 2 000 товаров, а перед массовой загрузкой отдельно прогоните нагрузочный сценарий на 5 000 товаров как проверку технического запаса.

## Проверка перед передачей изменений

Минимум:

```bash
npm ci
npm run check
npm run build
```

Если менялись миграции или доступ к данным:

```bash
npm run schema:check
```

Исторический план ранних технических работ и контекст прежних решений находятся в `docs/ROADMAP.md`; нумерация его фаз не соответствует текущим QA-фазам, а незавершённые или конфликтующие указания из него нельзя исполнять без повторной проверки и отдельного разрешения. Фиксированные продуктовые ограничения и текущая продуктовая направленность описаны в `PROJECT_BRIEF.md`. Живой план QA-remediation, статусы находок и критерии приёмки ведутся в [`docs/QA_REMEDIATION_PLAN.md`](docs/QA_REMEDIATION_PLAN.md).
