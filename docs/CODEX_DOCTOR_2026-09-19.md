# Codex Doctor — 2026-09-19

## Исправлено и проверено

- Выполнен штатный `codex doctor --json`: установка, вход в Codex, конфигурация, сеть, WebSocket, Desktop/app-server, sandbox helpers и локальные SQLite-базы доступны.
- Ложное предупреждение `node_repl` исключено smoke-проверкой: `cua_repl` успешно выполнил вызов. Контроль 2026-09-21 подтвердил, что `CODEX_WINDOWS_REGISTERED_CORE` передаётся Desktop-процессом в MCP, но отсутствует у отдельно запущенного терминального `codex doctor`; глобальную переменную создавать не нужно.
- Устранены известные уязвимости зависимостей:
  - `next`, `@next/env`, `eslint-config-next`: `16.2.11` → `16.3.5`;
  - `sharp`: `0.35.3` → `0.35.4`;
  - `fast-uri`: `3.1.5` → `3.1.8` через lockfile.
- `npm audit --omit=dev` после обновления: 0 уязвимостей.
- `npm run check`: PASS — lint, typecheck, проверка цветов, 111 файлов Vitest / 676 тестов. ESLint оставил только 2 предупреждения в сгенерированном `.wrangler/tmp`, ошибок нет.
- `npm run build`: PASS на Next.js `16.3.5`, 42 статические страницы.
- Supabase CLI `2.113.0`: локальный стек был поднят; `npm run e2e:preflight`, `npm run schema:declarative` и `npm run schema:check` прошли. Удалённая схема совпала: 17 public-таблиц и 5 Storage buckets.
- Docker Desktop установлен: `4.89.0`, Engine/CLI `29.7.2`.
- После разрешённого `wsl --shutdown` зависшее дерево Docker Desktop было завершено и запущено заново; `docker info` и E2E preflight снова прошли.
- `npm run e2e:smoke`: PASS — 13/13 Playwright-сценариев. Для этого исправлены две реальные причины шума браузера:
  - Speed Insights теперь подключается только при `VERCEL=1`;
  - E2E-подмена hero-видео перехватывает стабильный `/site-media/hero/` как для R2, так и для Supabase Storage.
- Финальный `codex doctor --json` с корректным `TERM` только для процесса завершился с кодом 0 и итогом `warning`; все основные проверки установки, auth, config, Git, сети/WebSocket, runtime, sandbox, SQLite и диска имеют статус `ok`.

## Диагностированный инцидент

- Во время первого smoke Docker Desktop потерял Linux backend. Журнал зафиксировал повторяющиеся `event streamer: error: EOF` и отказ соединения с локальным engine endpoint.
- Восстановление потребовало `wsl --shutdown`, принудительного завершения только зависших процессов Docker Desktop и чистого запуска приложения. Volumes и файлы проекта не удалялись.
- После 13 успешных тестов Node/Playwright один раз напечатал assertion `UV_HANDLE_CLOSING`, но процесс завершился с кодом 0. Это не считается падением тестов; при повторении стоит отдельно обновить/диагностировать Playwright или Node.

## Осталось интерактивным или системным

- Codex CLI: основной standalone в `PATH` — `0.153.4`, доступна стабильная `0.155.1`; внутри Desktop также есть отдельная сборка `0.155.0-alpha.9.2`. Не менять `PATH` на alpha-сборку. `codex update` ранее завис при запущенном Codex Desktop, поэтому обновлять standalone только после закрытия Desktop, затем проверить `codex --version` и `codex doctor --json`.
- GitHub CLI: OAuth восстановлен и проверен через `gh auth status`; активный аккаунт — `kwelves`, Git-протокол — HTTPS.
- Supabase MCP OAuth восстановлен и проверен 2026-09-21. Обычный `codex mcp login supabase` падал на DCR с HTTP 400: OAuth metadata Supabase рекламирует 24 scope, тогда как registration endpoint принимает только 13. Рабочий безопасный вход выполнен с явным read-only набором: `codex mcp login supabase --oauth-client-registration dcr --scopes organizations:read,projects:read,database:read,analytics:read,secrets:read,edge_functions:read,environment:read,storage:read`. После входа `codex mcp list` показывает `Auth: OAuth`; реальные вызовы MCP успешно вернули URL проекта и список `public`-таблиц. Токены не сохранялись в документации.
- Vercel CLI `59.16.0` установлен глобально; `vercel whoami` подтвердил аккаунт `room22`. Проверка напечатала нефатальный timeout фонового update-worker, но завершилась с кодом 0 и вернула аккаунт.
- Контрольный `codex migrate-rollouts --json` (dry-run) нашёл 2 eligible-сессии, обе созданы 2026-09-21. `--apply` не запускался: их не удалось доказать неактивными, а мигратор не исправляет найденные doctor-расхождения (5 отсутствующих строк и 2 дублированных thread ID). SQLite вручную не редактировать; для parity-проблемы штатная рекомендация doctor — приложить отчёт к bug report.
- Предупреждения Dev Drive и Microsoft Defender exclusions являются оптимизациями; Defender не ослаблялся автоматически.
- `TERM=dumb` и `NO_COLOR=1` задаются служебной неинтерактивной средой Codex: пользовательских и системных Windows-переменных с такими именами нет. Глобально добавлять `TERM` ради doctor не нужно.

## Безопасный порядок продолжения

1. После закрытия Codex Desktop обновить CLI и повторить doctor.
2. GitHub и Supabase OAuth восстановлены. Для Supabase не убирать явный список scope, пока metadata и registration endpoint публикуют несовместимые наборы.
3. При необходимости Vercel-команд установить/обновить CLI и проверить `vercel whoami`.
4. Если Docker снова зависнет с теми же симптомами, сначала завершить пользовательские WSL-задачи, затем повторить подтверждённую последовательность восстановления из раздела выше.

## Границы

- Push, deploy, DNS, удалённые миграции и изменения production не выполнялись.
- Существовавшие пользовательские файлы `.codex/`, `debug.log` и `docs/CLOUDFLARE_FREE_HOSTING_MIGRATION_PLAN.md` не изменялись и не включаются в чекпоинт.
- Локальные Supabase-ключи и другие секреты в этот документ не записаны.
