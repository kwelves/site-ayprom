# Claude: read-only reader нынешних учётных данных

Предыдущий verifier принят в integration как `c1e56c8`: Codex независимо прогнал 30 unit + 1 настоящий workerd test, всё прошло. Он остаётся неподключённым. Его полный прогон ещё проверяется Codex в integration; не выдавай прежние ошибки отсутствующей зависимости за успешную проверку.

## Рабочее место

Только `C:\Users\user\.codex\worktrees\ayprom-claude-mixed-pagination\site-for-kirsan`. Ожидаются чистая `codex/claude-legacy-password-verifier`, HEAD `2c7bd48ab093573ceaeb9e4a8aa2227f89a8d5bd`. Сохрани эту ветку; создай новую `codex/claude-credential-reader` от существующего локального `c1e56c8` (проверь полный SHA через Git). При отличии исходного состояния остановись. Не reset/rebase/merge. Новая база включает свежий bounded `json-request.ts` Codex.

Прочитай AGENTS.md, PROJECT_BRIEF.md, `src/lib/admin/credentials.ts`, `src/lib/admin/password-credential.ts`, `src/cloudflare/admin/legacy-password-verifier.ts`, `json-request.ts`, `supabase-ports.ts`, `supabase/migrations/20260821171707_admin_credentials.sql`, последние admin HTTP/legacy-verifier отчёты. Используй Supabase и Cloudflare навыки, актуальную документацию и Graphify. Dependencies в worktree могут отставать: допускается обычная установка из существующего lockfile без изменения manifest/lockfile и без production env; не маскируй непрошедшие проверки.

## Задача

Через TDD подготовь **неподключённый** framework-neutral `createAdminCredentialReader`, пригодный для `readCredentialState` в verifier. Только новые `src/cloudflare/admin/credential-reader.ts`, соответствующие unit/runtime tests и test-only helpers, новый отчёт. Existing json-request, verifier, worker.ts, handlers, package/runtime/smoke, SQL/seed и Next auth не менять. Нужные правки других участков предложи, не применяй.

1. Принимает server-only `{ SUPABASE_URL, ADMIN_SUPABASE_KEY }` и injected fetch. Возвращает функцию `Promise<LegacyCredentialState>`. Без process.env, Next, Supabase Auth login, кеша и singleton state.
2. Единственный запрос — GET `/rest/v1/admin_credentials`, select `password_hash,session_version`, filter `credential_key=eq.primary`, limit 2. Приватный ключ только в headers; apikey, для legacy JWT также Bearer по принятому локальному паттерну. Никаких ключей/пароля/hash в URL или логах. Никаких writes/RPC.
3. Переиспользуй `requestAdminJson` Codex: общий deadline 10 с включая body, максимум 64 КиБ, manual redirects с отказом, никаких повторов. Проверяй URL scheme/userinfo и bindings до fetch. Успех только при корректном HTTP-ответе и валидном массиве максимум из одной строки; неожиданные статусы/JSON/body — отказ.
4. **Явная политика:** `[]` при успешном запросе означает `{passwordHash:null,sessionVersion:1}`. Отсутствие таблицы (`PGRST205`, `42P01`, 404), permission/auth errors, outage и повреждённые ответы НЕ равны пустой таблице, fallback запрещён. Это намеренно строже исторического Next adapter; его не менять.
5. Строка должна иметь непустой string password_hash и safe-integer session_version, соответствующий SQL constraint >=2. Null/undefined/empty hash в существующей строке — отказ. Не копируй разбор PBKDF2: malformed непустой encoded hash проверяет verifier, не этот reader. Свежий state читается каждый раз, входные данные не мутируются.
6. Ошибки только фиксированные code/message, без cause/payload/hash/key/backend details. Результат reader остаётся приватным, публичной HTTP-точки возврата state не создавай.
7. RED→GREEN: empty, singleton/golden hash/version, две строки, невалидные поля/версии, malformed JSON, 404/missing-table, 401/403/5xx, redirect без перехода/утечки ключа, oversized/stalled body, последовательная смена состояния; точный URL/method/headers и отсутствие writes. Интеграционный тест reader + legacy verifier: outage не открывает env fallback; [] открывает только фиктивный env, hash не читает env. Проверка настоящим закреплённым workerd с контролируемым loopback HTTP fixture, без Supabase-стека и внешней сети; ответы test-entry только boolean/code.

Не запускай/останавливай Docker/Supabase и не читай production секреты. Ни push/deploy/merge, ни смена ADMIN_PASSWORD/credential row. focused tests, lint/typecheck/colors, `npm test` (maxWorkers=2 уже в скрипте), diff-check, Graphify, checkpoint только своих файлов. В отчёте — RED/GREEN, точные результаты, статус, предложение подключения без его применения.

Важное уточнение предыдущего отчёта: перенос формы смены пароля на Vercel НЕ решает потенциальный CPU-блокер. Если Vercel запишет тот же PBKDF2-хеш в общую таблицу, Worker всё равно должен его проверить. CPU/iteration limits остаются внешним gate; алгоритм и 600 000 итераций не ослаблять.

Рекомендуемая модель: **Sonnet 5 High**. При сложном security-review — **Opus 5.5 High**, без изменения архитектуры/криптографии по собственной инициативе.
