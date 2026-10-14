# Read-only reader текущих учётных данных админки

Дата: 2026-09-30. Ветка: `codex/claude-credential-reader` от `c1e56c8758439ff3dc400e2c635734e24d8fc6dc`.
Только локальная работа. Push, deploy, merge, изменения `ADMIN_PASSWORD`, строки `admin_credentials`, SQL/seed, Docker и Supabase не выполнялись. Production-секреты не читались.

## Что сделано

`src/cloudflare/admin/credential-reader.ts` — `createAdminCredentialReader({ SUPABASE_URL, ADMIN_SUPABASE_KEY }, fetcher?)`. Функция возвращает `() => Promise<LegacyCredentialState>` — форму `readCredentialState` для `createLegacyPasswordVerifier`. Модуль **никуда не подключён**. `json-request.ts`, verifier, `worker.ts`, handlers, `supabase-ports.ts`, package/smoke, SQL и Next auth не менялись.

**Запрос.** Ровно один `GET /rest/v1/admin_credentials?select=password_hash%2Csession_version&credential_key=eq.primary&limit=2` на каждый вызов. Без кэша, повторов, записей и RPC. Путь, query и fragment из `SUPABASE_URL` заменяются, а не дополняются.

**Заголовки.** `apikey: <ключ>` и `accept: application/json`. Для ключа `eyJ…` дополнительно `authorization: Bearer`, как в `supabase-ports.ts`. Ключ не попадает в URL и логи.

**Транспорт — существующий `requestAdminJson`:**
- общий срок 10 секунд, включая чтение тела;
- не больше 64 КиБ;
- `redirect: "manual"`, любой 3xx отклоняется без перехода;
- без повторов.

**Проверка bindings до fetch.** Отклоняются: пустой или непарсируемый URL, схема не http/https, userinfo, пустой ключ, ключ с пробелами или управляющими символами (перевод строки).

**Успех — только HTTP 200 и массив не длиннее одной строки:**
- `[]` → `{ passwordHash: null, sessionVersion: 1 }`;
- одна строка → непустой строковый `password_hash` и safe-integer `session_version` ≥ 2, как требует SQL-ограничение `admin_credentials_session_version_check`. Возвращается новый объект, ответ не мутируется. Непустой, но повреждённый PBKDF2-хеш передаётся как есть: его разбирает verifier, reader этот разбор не дублирует.

**Намеренно строже исторического Next-адаптера.** Отсутствие таблицы (`PGRST205`, `42P01`, 404), 401/403, 5xx, redirect, битый JSON, oversized или зависшее тело, две строки, невалидные поля и статусы 2xx кроме 200 — всё это отказ, а не «пустая таблица». Fallback на env через reader невозможен. `src/lib/admin/credentials.ts` не менялся.

**Ошибки.** `AdminCredentialReaderError` с кодом `configuration_invalid` | `backend_unavailable` | `response_invalid`. Сообщение всегда одно: `Admin credential state unavailable`. Нет `cause`, payload, ключа и хеша; модуль ничего не логирует. Под verifier любая ошибка reader превращается в `credential_state_unavailable`.

## RED → GREEN

1. **Unit, модуль отсутствует:** импорт не разрешается.
2. **Unit, содержательный RED:** временная заглушка с семантикой исторического адаптера (`PGRST205`/`42P01` считаются пустой таблицей, берётся первая строка, нет проверки статуса, bindings и размера) — **54 failed / 8 passed из 62**.
3. **Unit GREEN:** **62/62**. В наборе: пустая таблица; одна строка с golden-хешем и версией; две строки; невалидные поля и версии (включая версию 1); битый JSON; 404/missing-table; 401/403/5xx; redirect 301/302/307/308 без перехода; oversized и зависшее тело (fake timers: не прерывается на 9 999 мс, прерывается и отменяется после 10 000); последовательная смена состояния; точные URL, метод и заголовки; JWT-Bearer; отсутствие body и записей; невалидные bindings без fetch; неизменность bindings и ответа; отсутствие логов и секретов в ошибках.
4. **Интеграция reader + legacy verifier:** в том же наборе. Outage, 404 PGRST205, 403 и две строки не открывают env; `[]` пропускает только фиктивный env-пароль с версией 1; строка с хешем проверяет только хеш и не читает env.
5. **Runtime RED:** тот же runtime-тест на настоящем workerd с заглушкой **упал**: две строки были приняты как валидное состояние. После возврата реального модуля — GREEN.

## Что доказано на настоящем workerd

`tests/cloudflare-admin-credential-reader-runtime.test.ts`: закреплённый Wrangler 4.135.0 `dev --local`, без аккаунта и deploy, против loopback HTTP-фикстуры в самом тесте. Supabase-стек и внешняя сеть не использовались. Test-entry `tests/support/credential-reader-runtime-entry.ts` отвечает только boolean и кодами.

- `[]` → пустое состояние с версией 1. Строка → хеш есть, версии 2 и 3 читаются заново на каждый вызов. Две строки → `response_invalid`.
- `404 PGRST205`, 403, 503, 307, oversized (70 000 байт) и битый JSON → `backend_unavailable`.
- **Под verifier:** `[]` + фиктивный env → `true`, неверный пароль → `false`. Golden-хеш → `true`, env-пароль против хеша → `false`, env не читается. Missing-table, outage и 403 → `credential_state_unavailable`, env не читается.
- **Зависшее тело** (200, `[` без конца) прервано общим сроком: отказ между 9 и 30 секундами wall time. Это проверка срока, а не измерение CPU.
- **Каждый запрос:** ровно один на вызов, `GET` на точный путь и query, `apikey` = фиктивный ключ, без `authorization` для `sb_secret_*`. Redirect-sink получил **0** обращений. Ответы entry не содержат ключа, хеша, паролей и деталей backend.

## Проверки

- **Зависимости.** В worktree не было `@xmldom/xmldom`, объявленного в `package.json`/`package-lock.json`. Выполнен `npm ci --no-audit --no-fund` строго по lockfile (install-скриптов в проекте нет): 624 пакета, `package.json` и `package-lock.json` не изменились. Прежние ошибки typecheck и static-producer объяснялись именно отсутствием пакета, а не проходили.
- Focused (reader unit + runtime, verifier unit + runtime, json-request, supabase-ports): **6 файлов, 108/108**.
- `npm run lint`: чисто. `npm run typecheck`: чисто. `npm run check:colors`: 299 файлов, прямых цветов нет.
- `npm test` (скрипт уже содержит `--maxWorkers=2`): **exit 0, 164 файла passed + 1 skipped, 1340 тестов passed + 4 skipped**.
- `git diff --check`: чисто. Graphify обновлён.

## Предлагаемое подключение (не применено)

```diff
 // src/cloudflare/worker.ts
+import { createAdminCredentialReader } from "@/cloudflare/admin/credential-reader";
+import { createLegacyPasswordVerifier } from "@/cloudflare/admin/legacy-password-verifier";
 interface AdminWorkerEnv extends Env {
+  ADMIN_PASSWORD?: string;
 ...
+        const legacyVerifier = createLegacyPasswordVerifier({
+          readCredentialState: createAdminCredentialReader({
+            SUPABASE_URL: env.SUPABASE_URL,
+            ADMIN_SUPABASE_KEY: admin.ADMIN_SUPABASE_KEY,
+          }),
+          readEnvPassword: () => admin.ADMIN_PASSWORD,
+        });
         const handleAdmin = createAdminHandler({
-          ...privatePorts,
+          reserve: privatePorts.reserve,
+          finish: privatePorts.finish,
+          ...legacyVerifier,
```

Сопутствующие изменения, которые я только предлагаю:

- Проверку обязательных bindings админки перевести с `ADMIN_AUTH_EMAIL`/`ADMIN_AUTH_USER_ID` на `ADMIN_PASSWORD`. `createSupabaseAdminPorts` сейчас требует Auth-bindings даже для `reserve`/`finish`; при переключении их нужно либо выделить в отдельный порт, либо перестать требовать.
- После переключения `supabase-ports.credentialVersion` станет лишним. Если его оставить, стоит поднять минимальную версию строки с 1 до 2 по SQL-ограничению: сейчас он принимает строку с версией 1.
- `ADMIN_PASSWORD` задавать Worker'у только отдельной секретной привязкой, без значения в пакете.

## Уточнение к прежнему отчёту и внешние gates

Прежний отчёт упоминал «смену пароля только на Vercel» как вариант снятия CPU-блокера. Это **неверно**. Если Vercel запишет тот же PBKDF2-хеш на 600 000 итераций в общую таблицу, Worker всё равно должен его проверить при входе, и CPU-стоимость проверки не исчезает.

Остаются внешние gates:
- CPU Workers Free (10 ms), измеряемый только в сети Cloudflare;
- возможный production-лимит итераций PBKDF2.

Алгоритм и 600 000 итераций не ослаблялись.

Также не проверено: реальный PostgREST с настоящей таблицей и `service_role`-ключом (без Supabase-стека по условию задачи); удалённый staging; перенос смены пароля и инвалидирования сессий на Worker.
