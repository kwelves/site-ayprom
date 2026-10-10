# Legacy admin ports: reserve/finish без Supabase Auth

Дата: 2026-09-30. Ветка `codex/claude-legacy-admin-ports` от `72ad6d80bc09e57c9c789a3499955b1238d4b971` (включает snapshot состояния до crypto await).
Только локальная работа: `worker.ts`, preview, smoke, handler, verifier, reader, криптография, публичный поиск, Next, SQL, env, producer/package, main и чужие worktrees не менялись. Docker/Supabase не запускались. Push, merge, deploy не выполнялись.

## Что сделано

- **`supabase-ports.ts`.** Выделена `createAdminAttemptPorts({ SUPABASE_URL, ADMIN_SUPABASE_KEY }, fetcher?)` → `reserve`/`finish`. Реализация перенесена, а не скопирована: те же два RPC (`begin_admin_auth_attempt`, `finish_admin_auth_attempt`), те же тела, валидация ответов и `requestAdminJson` без изменения лимитов (10 с включая тело, 64 КиБ, manual redirect). `createSupabaseAdminPorts` теперь берёт `reserve`/`finish` оттуда; `verifyPassword` (GoTrue) и `credentialVersion` не менялись.
- **`legacy-admin-ports.ts` (новый, не подключён).** `createLegacyAdminPorts({ SUPABASE_URL, ADMIN_SUPABASE_KEY, ADMIN_PASSWORD? }, fetcher?)` объединяет `createAdminAttemptPorts`, `createAdminCredentialReader` и `createLegacyPasswordVerifier`. Возвращает `reserve`, `finish`, `verifyPassword`, `verifyPasswordWithVersion`, `credentialVersion`. Email, user id, публичный ключ и `/auth/v1/token` не нужны и не используются. `ADMIN_PASSWORD` — необязательный серверный binding: при существующем хеше он не нужен; при пустой строке без него вход закрыт (`env_password_unavailable`). Значения bindings копируются при создании, последующие изменения объекта не учитываются.

## Одно намеренное отличие прежнего адаптера

Ключ с символами, недопустимыми в значении HTTP-заголовка (не-ASCII, перевод строки), прежний `createSupabaseAdminPorts` отклонял сырым `TypeError` из `new Headers`. Теперь это фиксированная `Admin protection unavailable`, без эха ключа. Принимаемые значения не сузились, порядок проверок и остальное внешнее поведение прежние.

Для композиции добавлен ранний отказ для ключа с любым символом вне видимого ASCII (после trim). Причина: reader такой ключ отвергает, а attempt-порты (как и прежний адаптер) допускают внутренние пробелы или табы. Без этого reservation проходила бы, а чтение строки падало. Правило дублирует одну регулярку reader, чтобы не менять reader.

## RED → GREEN

- **RED:** тесты не запускались — `createAdminAttemptPorts` и модуль `legacy-admin-ports` отсутствовали. Отдельная неприятная проверка: одна из первых GREEN-попыток упала на ключе с табом (композиция «наполовину работала»). Это исправлено ранним отказом выше.
- **GREEN unit:** `tests/cloudflare-admin-legacy-admin-ports.test.ts` вместе с прежними `cloudflare-admin-supabase-ports` и `cloudflare-admin-http-boundary`: **3 файла, 61/61**.
- **Runtime RED:** тот же workerd-тест без `legacy-admin-ports.ts` — **упал** (`workerd_not_ready`, Worker не собирается). **Runtime GREEN:** 1/1, повторно 2/2 подряд.

Покрыто:
- фабрика без email и user id;
- пустая строка → env-proof версии 1;
- хеш версий 2 и 7 → proof соответствующей версии;
- env-пароль вместо существующего хеша отклоняется;
- hash-only без `ADMIN_PASSWORD`;
- 9 сбоев строки (две строки, hash null, версия 1, битый JSON, 404 `PGRST205`/`42P01`, 401, 403, 503) не дают fallback ни в одном из трёх методов;
- 6 видов неверных bindings без единого fetch и без ключа в ошибках;
- reserve/finish побайтно совпадают по URL и телу с прежним адаптером; Bearer только для JWT-ключа;
- ни одного обращения к `/auth/*`, точная последовательность запросов;
- bindings не мутируются;
- отсутствие вывода в консоль;
- композиция с настоящим handler: cookie версии 3, env-пароль не входит при хеше, outage/нет таблицы/две строки закрывают вход и делают `finish(false)`.

## Что доказано на настоящем workerd

`tests/cloudflare-admin-legacy-admin-ports-runtime.test.ts`: закреплённый Wrangler 4.135.0 `dev --local` против loopback HTTP-фикстуры в тесте. Supabase и Docker не запускались, внешней сети нет. Test-entry `tests/support/legacy-admin-ports-runtime-entry.ts` получает bindings через wrangler vars с фиктивными значениями и отдаёт только редиректы, boolean и коды.

- Пустая строка + env → cookie версии 1; запросы ровно `reserve → GET credentials → finish → GET credentials`.
- Хеш версии 3 + golden → cookie версии 3; env против хеша → `error=1`, `finish(false)`.
- Неверный пароль → `error=1`.
- Нет таблицы, outage 503, две строки → `error=security`, без cookie, `finish(false)`, без fallback на env.
- Пустой URL или ключ → `Admin protection unavailable`, ни одного запроса к backend.
- **Каждый** запрос к backend: ключ только в `apikey`, без `Authorization`, не в теле, ни одного `/auth`.
- **Приватного ключа нет** ни в одном ответе Worker и ни в перехваченном выводе Wrangler/workerd (проверка захвата: лог содержит записи `/login`). Также нет паролей, хеша и cookie.

## Проверки

- `npm run check`: **exit 0**; lint, typecheck и check:colors чистые; **169 файлов passed + 1 skipped, 1450 тестов passed + 4 skipped**.
- `git diff --check` и Graphify: см. итог.

## Ограничения

- **Локальный workerd не применяет лимиты CPU.** Worker Free CPU для PBKDF2 на 600 000 итераций остаётся внешним gate; wall time не выдаётся за CPU.
- **Не подключено.** `worker.ts` и packaged smoke по-прежнему используют Supabase Auth fixture; путь с настоящей credential row проверен только этим фикстурным backend.
- Реальный PostgREST с настоящей таблицей `admin_credentials` и `service_role`-ключом не использовался (по условию).
- Смена пароля и инвалидирование сессий на Worker не перенесены.

## Предложение подключения (не применено)

```ts
const legacy = createLegacyAdminPorts({
  SUPABASE_URL: env.SUPABASE_URL,
  ADMIN_SUPABASE_KEY: admin.ADMIN_SUPABASE_KEY,
  ADMIN_PASSWORD: admin.ADMIN_PASSWORD,
});
const handleAdmin = createAdminHandler({ ...legacy, readProducts, assets, secret, clientIp, now });
```

Проверку обязательных admin-bindings в `worker.ts` нужно заменить: `ADMIN_AUTH_EMAIL`/`ADMIN_AUTH_USER_ID` для этого пути не нужны, `ADMIN_PASSWORD` задаётся только отдельной секретной привязкой. Isolated smoke стоит перевести на настоящую credential row и env-сценарий.
