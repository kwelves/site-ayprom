# Защита входа от смены версии между проверкой пароля и выдачей сессии

Дата: 2026-09-30. Ветка `codex/claude-login-version-proof` от `0e778bd0bb76ebb340a3533856fba4cf4558daa4`.
Только локальная работа: push, merge, deploy, SQL, env, Docker/Supabase, `worker.ts`, producer/package, Next и production не менялись. Verifier и reader по-прежнему **не подключены** к Worker.

## Проблема

Handler получал boolean проверки пароля, затем отдельным вызовом версию. Если пароль сменили между ними, старый пароль получал cookie новой версии. Тест-характеристика в новом наборе воспроизводит это на прежнем раздельном пути: cookie выдаётся с версией 3.

## Что изменено

- **`contracts.ts`.** Тип `AdminPasswordProof = { valid: false } | { valid: true; credentialVersion }` и необязательный порт `verifyPasswordWithVersion(password)`.
- **`legacy-password-verifier.ts`.** Новый метод `verifyPasswordWithVersion`: **одно чтение состояния и одна проверка пароля**. Версия берётся из того же состояния, по которому проверялся пароль. Хеш-путь, env-путь, коды отказов и запрет fallback те же, что у `verifyPassword`; прежние методы не менялись. Вынесена общая внутренняя проверка, криптография и 600 000 итераций не тронуты.
- **`handler.ts`.** Если новый порт есть:
  - старый `verifyPassword` не вызывается, в том числе после ошибки;
  - результат проверяется строго: объект с `valid: false` либо `valid: true` и safe-integer версией ≥ 1. Всё остальное — malformed;
  - malformed или ошибка порта → `finish(false)` один раз, редирект `error=security`, cookie нет;
  - после `finish` текущая версия читается через `credentialVersion()` и сверяется с проверенной: несовпадение или ошибка → без cookie;
  - cookie выпускается только с проверенной версией.

  Без нового порта путь прежний: `verifyPassword` → `finish` → `credentialVersion`.

Позднейшая смена версии инвалидирует сессию при следующем защищённом запросе: уже работающая сверка версии в handler. Она отдельно подтверждена тестом и на workerd.

## RED → GREEN

- **Unit RED** (тип в контракте уже был, handler/verifier — без изменений): **35 failed / 13 passed из 48**. Падали стабильная версия, сверка при смене, проверка неверного пароля новым портом, 15 видов malformed, ошибка нового порта и все проверки нового метода verifier. Тест «прежние методы» тоже падал: неиспользованная one-shot подмена PBKDF2 из предыдущего RED-теста протекала вперёд; подмена переписана на безопасную (`try/finally` + `mockRestore`).
- **Unit GREEN:** новый набор + прежние `cloudflare-admin-handler` и `cloudflare-admin-legacy-password-verifier`: **3 файла, 96/96**.
- **Runtime RED:** тот же workerd-тест на коде без правок handler/verifier — **упал**.
- **Runtime GREEN:** **1/1**.

Покрыто: стабильная версия; смена 1→2 и 2→3 после чтения состояния и во время `finish`; неверный пароль (включая env-пароль против хеша и старый порт, вернувший `true`); malformed proof (15 вариантов); ошибка reader/verifier; отсутствие fallback; `finish` ровно один раз (`true` для успеха и смены, `false` для неверного, malformed и ошибки); отсутствие cookie при любом отказе; rate limit после `finish`; некорректная текущая версия; сбой `finish`; отказ резервации; адаптер без нового порта. Интеграция handler + verifier + меняющееся состояние: два чтения (проверка и сверка), при смене cookie нет.

## Что доказано на workerd

`tests/cloudflare-admin-login-version-proof-runtime.test.ts`, закреплённый Wrangler 4.135.0 `dev --local`, без Supabase и сети. Entry `tests/support/login-version-proof-runtime-entry.ts` запускает **настоящие** handler и verifier против изменяемой in-memory «строки учётных данных». Смена версии вносится ровно после чтения состояния или внутри `finish`. Entry отдаёт только редиректы, boolean и счётчики; тест проверяет, что в ответах нет cookie, паролей, хеша.

| Сценарий | Результат в workerd |
|---|---|
| стабильная версия, верный пароль | cookie версии 2, `finish [true]`, старый порт 0 вызовов, 2 чтения; следующая смена 2→3 → `/admin` даёт 302 `session=expired` |
| пустая строка + env | cookie версии 1 |
| смена 2→3 после чтения состояния | `error=security`, cookie нет |
| смена 2→3 во время `finish` | `error=security`, cookie нет |
| неверный пароль / env против хеша | `error=1`, `finish [false]`, cookie нет |
| outage reader | `error=security`, `finish [false]`, cookie нет |
| malformed proof | `error=security`, `finish [false]`, 0 чтений, старый порт 0 вызовов |

## Проверки

- `npm run check` (lint, typecheck, check:colors, тесты): **exit 0**, 167 файлов passed + 1 skipped, **1406 тестов passed + 4 skipped**. `--maxWorkers` не дублировался.
- `git diff --check` и Graphify: см. итог в сообщении.

## Ограничения

- **Остаточное окно.** Между сверкой версии после `finish` и выдачей cookie версия теоретически может измениться ещё раз. Это допустимо: cookie несёт проверенную версию и будет отклонён при следующем защищённом запросе. Защита закрывает выдачу сессии новой версии по старому паролю, а не саму гонку смены пароля.
- **Wall time и локальный runtime не доказывают CPU.** Локальный workerd не применяет лимиты Cloudflare; Worker Free CPU для PBKDF2 600 000 остаётся внешним gate.
- **Не подключено.** `worker.ts` использует прежние `createSupabaseAdminPorts`. Сначала подключение делает Codex; тогда `verifyPasswordWithVersion` нужно передать в `createAdminHandler` через spread `...legacyVerifier` (метод уже входит в возвращаемый объект).
- Реальный PostgREST и настоящая таблица не использовались (по условию: без Supabase); проверялась логика handler/verifier на управляемых подстановках.
