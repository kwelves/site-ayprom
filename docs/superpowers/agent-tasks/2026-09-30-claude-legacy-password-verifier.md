# Задание Claude: локальный verifier нынешней схемы пароля

## Рабочее место

Только `C:\Users\user\.codex\worktrees\ayprom-claude-mixed-pagination\site-for-kirsan`.
Ожидается чистая `codex/claude-worker-api-headers`, HEAD `db95a7c59d31bb25baa8fcad6e74091f70a565be`. Проверь. Сохрани прежнюю ветку и создай новую `codex/claude-legacy-password-verifier` от существующего локального commit `1c53c4546723bba2d8c96ea2aa8594667706cb95`. Не reset/rebase/merge. При отличии фактов остановись и сообщи.

Прочитай AGENTS.md, PROJECT_BRIEF.md, registry, последний admin-readonly отчёт, `src/lib/admin/credentials.ts`, `src/lib/admin/password-credential.ts`, `src/lib/admin/session-codec.ts` и существующие password/session тесты. Используй доступные Cloudflare/Supabase навыки, актуальные docs и Graphify. Production env/секреты не копируй.

## Цель

Нынешняя production-админка использует ADMIN_PASSWORD, пока credential row пуста. Локальный preview пока доказывает другой verifier — Supabase Auth с тестовым пользователем. Нужно подготовить **неподключённый автоматически** framework-neutral adapter проверки нынешней схемы, чтобы последующая интеграция не требовала менять пароль или переводить пользователя в Supabase Auth.

Разрешённые файлы: новый `src/cloudflare/admin/legacy-password-verifier.ts`, новые тесты этого модуля и отдельный runtime test/helper entry (в tests/support при необходимости), отчёт `docs/superpowers/reports/2026-09-30-claude-legacy-password-verifier.md`. Legacy files, worker.ts, handler.ts, supabase-ports.ts, smoke, package builder, schema и публичный поиск **не редактировать**. Codex отдельно укрепляет HTTP adapter; ты не реализуешь сетевой reader.

## Контракт и требования

1. Модуль принимает injected `readCredentialState(): Promise<{ passwordHash: string | null; sessionVersion: number }>` и server-only envPassword (или getter), возвращает методы verifyPassword/password state version, пригодные для последующей передачи auth handler. Никаких process.env, Next, server-only imports или singleton mutable state внутри модуля.
2. Состояние читается заново; sessionVersion — safe integer >=1. Backend error/невалидный state не превращается в fallback. Fallback разрешён **только** для явно полученного `passwordHash: null`; валидировать env secret согласно существующей политике длины. Версия при пустой строке БД приходит от injected reader; не домысливать отсутствие таблицы.
3. Переиспользуй существующие `constantTimePasswordEqual` и `verifyAdminPasswordHash`, не копируй криптографию. Hash present => только hash; неверный hash/пароль не должен проверять старый env пароль. Не снижать PBKDF2 600000 и не менять encoded format.
4. Обязательны RED→GREEN unit tests: env correct/wrong/Unicode; missing/short env; hash overrides env; malformed hash; invalid version; reader outage; no logging/secret in errors; последовательные изменения state не кэшируются.
5. Проверь **на настоящем закреплённом workerd**, а не только Node: сравнение env-password и существующий golden PBKDF2 hash формата 600000. Используй исключительно фиктивные пароли. Если workerd отказывает из-за iteration limit/CPU/API, документируй конкретный результат; adapter должен безопасно отказать, не fallback на env и не сообщать, что hash-path готов. Не называй wall time доказательством Worker Free CPU.
6. В runtime fixture entry не публикуй пароль/hash/state: только безопасный boolean/error code. Не запускай Supabase, он этому модулю не нужен. Локальный Wrangler без аккаунта/deploy; если runtime отсутствует, зафиксируй непроверенный gate, не обходи его моками.
7. focused tests, lint/typecheck/check:colors, `npm test -- --maxWorkers=2`, diff-check, Graphify, checkpoint только своих файлов. В отчёте предложи точный integration diff/следующий шаг, но **не переключай** текущий preview или production verifier.

Никаких push/deploy/merge, production SQL/R2/DNS, изменения ADMIN_PASSWORD/credential row, смены hash или общих сервисов. Итог: commit/status, RED/GREEN, проверки, что доказано на workerd, что осталось блокером.

Рекомендуемая модель: **Sonnet 5 High**. Если потребуется менять криптографический алгоритм или production-схему, не меняй их; сообщи блокер Codex. Дополнительный review сложного вывода можно сделать Opus 5.5 High.
