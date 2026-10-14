# Локальный verifier нынешней схемы пароля админки

Дата: 2026-09-30. Ветка: `codex/claude-legacy-password-verifier` от `1c53c4546723bba2d8c96ea2aa8594667706cb95`.
Только локальная работа: push, deploy, merge, production SQL/R2/DNS не выполнялись. `ADMIN_PASSWORD`, строка `admin_credentials`, хеши и общий Supabase не трогались. Supabase для этой работы не запускался.

## Что сделано

`src/cloudflare/admin/legacy-password-verifier.ts` — адаптер нынешней production-схемы: PBKDF2-хеш из `admin_credentials`, если он есть, иначе серверный `ADMIN_PASSWORD`. Модуль **никуда не подключён**: `worker.ts`, `handler.ts`, `supabase-ports.ts`, preview и production verifier не менялись.

```ts
createLegacyPasswordVerifier({
  readCredentialState(): Promise<{ passwordHash: string | null; sessionVersion: number }>,
  readEnvPassword(): string | undefined,
}): Pick<AdminAuthPorts, "verifyPassword" | "credentialVersion">
```

Возвращаемые методы совпадают по типу с портами `createAdminHandler`. Внутри модуля нет `process.env`, Next, `server-only` и изменяемого состояния на уровне модуля. Криптография не копировалась: используются существующие `verifyAdminPasswordHash` (PBKDF2-SHA256, 600 000 итераций, прежний формат) и `constantTimePasswordEqual`.

## Поведение

| Состояние от reader | `verifyPassword` | env читается |
|---|---|---|
| `passwordHash: null` + допустимый env | сравнение с env: `true`/`false` | да |
| `passwordHash: null` + env отсутствует, <12 байт UTF-8 или плейсхолдер | отказ `env_password_unavailable` | да |
| непустая строка хеша | только `verifyAdminPasswordHash`: `true`/`false`; повреждённый хеш даёт `false` | **нет** |
| сбой PBKDF2 в runtime (например, лимит итераций) | отказ `password_hash_verification_failed` | **нет** |
| reader бросил исключение | отказ `credential_state_unavailable` | нет |
| `""`, `undefined`, не строка, `null` вместо объекта, версия не safe integer ≥ 1 | отказ `credential_state_invalid` | нет |

- **Строже legacy.** `src/lib/admin/credentials.ts` уходит в env при любом «ложном» хеше. Адаптер переходит в env только при явном `passwordHash: null`.
- **Отказ — это исключение.** `createAdminHandler` трактует исключение как fail-closed `error=security`, а `false` — как неверный пароль.
- **Кэша нет.** Состояние читается при каждом вызове, в отличие от 10-секундного кэша версии в legacy.
- **Ошибки без деталей.** Ошибки несут только `code`: без `cause`, текста backend, пароля или хеша. Модуль ничего не логирует.
- **Политика env** (≥12 UTF-8 байт, запрет документированного и типовых плейсхолдеров) повторяет закрытое правило `SERVER_SECRET_RULES.ADMIN_PASSWORD` из `src/lib/env.ts`. Отдельный тест проверяет совпадение с `requireServerEnv("ADMIN_PASSWORD")` на 11 значениях.
- **Unicode сравнивается побайтно, без нормализации**, как в legacy: NFC-пароль не совпадает со своей NFD-записью.
- **Версия при пустой строке приходит от reader.** Модуль не домысливает ни её, ни отсутствие таблицы. Legacy считает `PGRST205/42P01` пустой строкой с версией 1; повторить это или нет, решает будущий reader.

## RED → GREEN

1. **RED без модуля:** импорт не разрешается.
2. **Содержательный RED:** временная заглушка дословно повторяла логику legacy `verifyAdminPassword`. Из 30 тестов 21 упал: небезопасный или отсутствующий env, сбой PBKDF2, 11 видов невалидного состояния (включая `passwordHash: ""` и `undefined`, при которых legacy молча уходит в env), сбой reader.
3. **GREEN после реализации:** 30/30.
4. **Найденная ошибка в тесте:** default-параметр хелпера подставлял фикстуру вместо явного `undefined`, так что кейс «env отсутствует» фактически не проверялся. Хелпер исправлен, 30/30.

Все пароли в тестах фиктивные (`tests/support/legacy-password-verifier-fixtures.ts`). Готового golden-хеша в репозитории не было: существующие тесты генерируют хеш со случайной солью. Добавлен golden-хеш фиктивного пароля: 600 000 итераций, соль из байтов 0..15. Он получен независимой реализацией `node:crypto.pbkdf2Sync`, и тест проверяет, что его принимает существующий `verifyAdminPasswordHash`.

## Что доказано на настоящем workerd

`tests/cloudflare-admin-legacy-password-verifier-runtime.test.ts` поднимает закреплённый локальный Wrangler 4.135.0 (`wrangler dev --local`, без аккаунта и deploy) с отдельной тестовой точкой входа `tests/support/legacy-password-verifier-runtime-entry.ts`. Точка входа отдаёт только boolean и код ошибки. Тест дополнительно проверяет, что в ответах нет паролей, хеша и соли.

- **Env-путь:** правильный пароль `true`, неверный `false`, Unicode `true`, NFD `false`, короткий env даёт отказ.
- **Golden-хеш PBKDF2-SHA256 на 600 000 итераций:** правильный пароль `true`, env-пароль против хешированной строки `false`, env при этом не читается.
- **Повреждённый хеш** даёт `false` без чтения env. **Сбой reader** даёт `credential_state_unavailable`. **Версия** возвращается как есть.
- **Факт о runtime:** закреплённый локальный workerd **принимает** `deriveBits` с 100 000, 100 001 и 600 000 итерациями. Ожидаемого отказа по лимиту итераций не было. Тест закрепляет этот факт, чтобы смена runtime стала заметной. Если runtime начнёт отказывать, тест требует `password_hash_verification_failed` без fallback на env. Этот путь в Node также покрыт заглушкой `deriveBits`, отвергающей вызов.

## Чего это не доказывает

- **Worker Free CPU.** Документация Cloudflare: лимиты CPU действуют только в сети Cloudflare, не в локальной разработке; Free — 10 ms CPU на запрос. Время выполнения здесь не измерялось и не выдаётся за CPU. PBKDF2 на 600 000 итераций — это 600 000 раундов HMAC-SHA256. Скорее всего, это значительно больше 10 ms CPU. Env-путь стоит два SHA-256.
- **Production-лимит итераций PBKDF2 в сети Cloudflare.** Поиск по документации Cloudflare ограничения не нашёл, но и отсутствие его не подтвердил. Если production откажет, адаптер закроет вход, а не откроет env.
- **Сетевой reader `admin_credentials`** не реализован: это задача Codex.

## Проверки

- Целевые: unit 30/30, runtime на workerd 1/1.
- `npm run lint` чист. `npm run check:colors`: 297 файлов, прямых цветов нет. `git diff --check` чист.
- `npm run typecheck`: единственная ошибка — отсутствующий `@xmldom/xmldom` в `sitemap-verification.ts`.
- `npm test` (скрипт уже содержит `--maxWorkers=2`): 1154 passed, 4 skipped, 3 failed; 150 файлов passed, 9 failed.
- **Все 9 падающих файлов** — `tests/cloudflare-static-producer-*`, причина `ERR_MODULE_NOT_FOUND @xmldom/xmldom`: пакет объявлен в `package.json`, но не установлен в этом worktree. На нетронутой базе (изменения убраны в stash) те же 3 теста CLI падают так же. Пакеты не ставились.
- Graphify обновлён.

## Предлагаемая интеграция (не применена)

После того как Codex добавит сетевой reader, например `createAdminCredentialReader({ SUPABASE_URL, ADMIN_SUPABASE_KEY })`:

```diff
 // src/cloudflare/worker.ts
+import { createLegacyPasswordVerifier } from "@/cloudflare/admin/legacy-password-verifier";
 interface AdminWorkerEnv extends Env {
+  ADMIN_PASSWORD?: string;
 ...
-        const handleAdmin = createAdminHandler({
-          ...privatePorts,
+        const legacyVerifier = createLegacyPasswordVerifier({
+          readCredentialState: createAdminCredentialReader({ SUPABASE_URL: env.SUPABASE_URL, ADMIN_SUPABASE_KEY: admin.ADMIN_SUPABASE_KEY }),
+          readEnvPassword: () => admin.ADMIN_PASSWORD,
+        });
+        const handleAdmin = createAdminHandler({
+          reserve: privatePorts.reserve,
+          finish: privatePorts.finish,
+          ...legacyVerifier,
```

Требования к reader: пустая строка возвращает `{ passwordHash: null, sessionVersion: 1 }`, как `INITIAL_CREDENTIAL_VERSION` в legacy. Любой сбой HTTP/JSON — исключение. Решение о трактовке `PGRST205/42P01` принимается явно. Секрет `ADMIN_PASSWORD` задаётся Worker'у только отдельной привязкой, без значения в пакете. Supabase Auth (`ADMIN_AUTH_EMAIL`/`ADMIN_AUTH_USER_ID`) после такой замены для входа не нужен.

## Оставшиеся блокеры

1. **CPU hash-пути на Workers Free.** Пока строка пуста, production использует env-путь, и он дёшев. Но первая же смена пароля в legacy-админке создаёт хеш на 600 000 итераций. С этого момента каждая попытка входа на Worker, вероятно, упрётся в лимит CPU в 10 ms. Нужны измерение на удалённом staging и решение: Paid-план, другой параметр хеша со своей миграцией или смена пароля только на Vercel. Схему и итерации я не менял.
2. **Production-лимит итераций PBKDF2 в Cloudflare** не проверен.
3. **Сетевой reader и привязка `ADMIN_PASSWORD`** отсутствуют (задача Codex).
4. **Смена пароля и инвалидирование сессий** на Worker не перенесены.
