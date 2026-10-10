# Неподключённый credential CAS writer

Дата: 2026-10-01. Ветка `codex/claude-credential-cas-writer` от `4a40a71da4ca152f46f101374230784b50aa41d9`. Прежняя ветка `codex/claude-legacy-ports-races` (`9956b87…`) сохранена.
Только локальная работа. Добавлены новый модуль, тесты, test-only fixture и этот отчёт. Next adapter (`credentials.ts`), handler, `worker.ts`, reader, `json-request.ts`, SQL, env, общий Docker/Supabase и чужие worktrees не менялись. Push, merge, deploy и production-запросов не было.

**Это внутренний writer, а не API смены пароля.** Аутентификация, текущий пароль, Origin/CSRF и создание хеша подключаются отдельно. К handler и `worker.ts` он не подключён.

## Что сделано

`src/cloudflare/admin/credential-writer.ts`: `createAdminCredentialWriter({ SUPABASE_URL, ADMIN_SUPABASE_KEY }, fetcher?, now?)` → `{ replacePasswordHash(hash, expectedVersion): Promise<number> }`. Схема таблицы и правила как у `replaceAdminPasswordHash` в Next-адаптере, поверх PostgREST с серверным ключом. SQL не менялся.

| Случай | Запрос | Успех / отказ |
|---|---|---|
| `expectedVersion = 1` (пустая таблица) | `POST /rest/v1/admin_credentials?select=session_version`, строка `primary` с версией 2, `Prefer: return=representation` | успех: статус 201 и ровно одна строка с версией 2. `409` с кодом `23505` (duplicate key) → `conflict` |
| `expectedVersion ≥ 2` | `PATCH …?credential_key=eq.primary&session_version=eq.N&select=session_version`, `session_version = N+1` | успех: статус 200 и одна строка с версией N+1. Пустой массив (обновлённой строки нет) → `conflict` |

- **Ошибки бывают только с фиксированным кодом:** `configuration_invalid`, `input_invalid`, `conflict`, `backend_unavailable`, `response_invalid`. Сообщения фиксированные, без `cause`, ключа, хеша и текста backend. Модуль ничего не логирует.
- **Не конфликт и не успех:** любой другой 409 (например, 23503), outage, 401/403, нет таблицы (404), redirect, битый JSON и oversized ответ → `backend_unavailable`. Неверная форма успешного ответа (не тот статус, версия не N+1, две строки, не массив, нет поля) → `response_invalid`.
- **До fetch отклоняются:**
  - версия не safe integer, < 1, а также такая, что `N+1` выходит за safe integer (переполнение);
  - пустой, не строковый или длиннее 1024 символов hash. Формат PBKDF2 писатель не разбирает, это дело verifier;
  - неверные bindings: пустой или непарсируемый URL, схема не http/https, userinfo, пустой ключ, ключ вне видимого ASCII.
- **Ключ** только в заголовках (`apikey`; для ключей `eyJ…` ещё и Bearer, как в `supabase-ports.ts`), ни в URL, ни в теле. Хеш только в теле запроса, не в URL.
- **Транспорт — существующий `requestAdminJson`:** 10 с включая тело, 64 КиБ, manual redirect, без повторов. Один запрос на вызов, никаких чтений, DELETE или RPC.

## RED → GREEN

- **Unit RED:** модуль отсутствовал (импорт не разрешался). **Unit GREEN:** `tests/cloudflare-admin-credential-writer.test.ts`, **74/74**: insert, update (версии 2, 5, 1 000 000), stale version, duplicate insert, другой 409, неверные ответы (16 видов), outage, redirect 301/302/307/308, oversized, зависшее тело (fake timers: не раньше 9 999 мс), сетевая ошибка, битый JSON, 11 видов неверной версии, 7 видов hash, 10 видов bindings, отсутствие утечек и консольного вывода, неизменяемость bindings, последовательные замены.
- **Runtime GREEN:** `tests/cloudflare-admin-credential-writer-runtime.test.ts` на закреплённом Wrangler 4.135.0: 1/1 (стабильно).

## Что доказано на workerd

**Backend в этом тесте фиктивный.** Это in-memory эмуляция нужных writer'у поведений PostgREST: 409/23505 на duplicate primary key, PATCH с фильтром по `session_version`, `return=representation`. Это не настоящий PostgREST и не Postgres. Supabase, Docker и внешняя сеть не использовались, все значения фиктивные. Проверяется поведение writer и запросов в настоящем workerd, а не реальные блокировки БД.

- Пустая таблица → INSERT даёт версию 2; reader (в том же workerd) видит хеш и версию 2. PATCH 2→3 обновляет строку.
- Устаревшая версия и повторный INSERT → `conflict`, строка не меняется.
- **Две параллельные замены** с одной ожидаемой версией: ровно одна успешна (версия 4), вторая — `conflict`.
- Outage, redirect (адрес redirect получил 0 обращений), oversized, битый JSON, чужой 409, неверная версия в ответе: ошибки без изменения строки, никогда не конфликт и не успех.
- Зависшее тело прервано общим сроком, примерно 9–30 секунд wall time (это проверка срока, не CPU).
- Неверные версии и hash, пустой ключ: отклонены **без единого запроса** к backend.
- Каждый запрос: ключ только в `apikey`, без `Authorization`, не в URL и не в теле; методы только GET (reader), POST, PATCH; путь только таблица `admin_credentials`; `Prefer: return=representation` у записи; ни одного `/auth`. Ключа, хеша и деталей backend нет ни в ответах Worker, ни в перехваченном выводе Wrangler.

## Отрицательный прогон

Новые тесты сначала прошли на первом же запуске, поэтому чувствительность проверена принудительными поломками writer. После каждой файл возвращался (итоговый файл побайтно совпадает с оригиналом):

| Поломка | unit | runtime |
|---|---|---|
| W1. PATCH без фильтра `session_version` | 4 упало | упал |
| W2. пустой результат PATCH — успех | 3 упало | упал |
| W3. duplicate insert — успех | 2 упало | упал |
| W4. ответ не проверяется на версию | 14 упало | упал |
| W5. ключ дополнительно уходит в URL | 7 упало | упал |
| W6. нет защиты от переполнения версии | 1 упал | упал |
| W7. любой 409 считается конфликтом | 3 упало | **сначала прошёл** |

W7 показал пробел: runtime-fixture не отдавала 409 с другим кодом. Я добавил режим `other-409`, и теперь W7 ловится и в runtime.

## Проверки

- `npm run check`: **exit 0**; lint, typecheck, check:colors чистые; **174 файла passed + 1 skipped, 1551 тест passed + 4 skipped**. Один прогон сначала упал на typecheck теста (TypeScript не видит присваивания внутри callback); поправлен в тесте.
- `git diff --check` и Graphify: см. итог.

## Ограничения

- **Нет реального PostgREST.** Реальные транзакции, блокировки и порядок записи в БД не проверялись. CAS опирается на условное обновление в БД.
- **Успех по представлению.** Успех подтверждается возвращённой строкой с версией N+1. Если запись прошла, а ответ потерян (таймаут), вызов даёт `backend_unavailable`; вызывающий не знает, применена ли замена. Повторять без чтения нельзя: следует прочитать состояние заново.
- **Не сделано:** проверка того, что переданный hash — валидный PBKDF2 нужного формата (это дело создателя хеша и verifier); аудит; инвалидирование сессий сверх роста версии.
- **CPU.** Локальный workerd не применяет лимиты Cloudflare. Создание хеша на 600 000 итераций в Worker — отдельный внешний gate по CPU.
- **Не подключено:** ни к handler, ни к `worker.ts`, ни к Next.
