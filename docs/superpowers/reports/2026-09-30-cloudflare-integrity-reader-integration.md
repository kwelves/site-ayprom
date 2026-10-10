# Локальная интеграция inventory и credential reader

Дата: 2026-09-30. Worktree: `C:\Users\user\.codex\worktrees\ayprom-integration\site-for-kirsan`, ветка `codex/cloudflare-integration`. Начальный HEAD: `686692181620354b0e3d5f487eb6f2828c218c40`.

## Изменения и независимый review

- Cursor `9c438ad` → `6879796`: SHA-256 inventory для Worker/config/site, read-only verification до preview runtime. Manifest не входит в собственную контрольную сумму.
- Cursor `0ad07f2` → `7746b0e`: metadata <=25 MiB до чтения, ограничение списка и обхода, безопасные фиксированные I/O ошибки. Независимый fault injection подтвердил oversized manifest без read и отказ чтения worker без исходного текста исключения.
- Claude `6e80d5d` → `47d6371`: reader выполняет только GET текущей primary credential row. Только успешный пустой массив означает отсутствие строки; missing table, ошибки доступа/сети, malformed payload не переключают вход на env-пароль. 10 s including body / 64 KiB, без retry/redirect, без вывода ключей/hash. Reader ещё не подключён к Worker.
- Codex RED→GREEN: три ключа с Unicode/C1 ранее давали необработанный Headers ByteString error либо доходили до fetch. Printable ASCII validation теперь отклоняет их безопасно до Headers и сети; окружающий whitespace по-прежнему нормализуется.

## Проверки

| Gate | Результат |
|---|---|
| Reader/runtime/integrity/preview/package focused tests | 5 файлов, 104 passed, exit 0 |
| npm run check | lint/typecheck/colors: exit 0; 299 color files; 165 test files passed, 1 skipped; 1357 tests passed, 4 skipped |
| npm run build, AYPROM_STATIC_BUILD=1 | exit 0, 36/36; только существующий loopback Supabase/public key, диагностические browser bindings |
| Реальный read-only credential GET | loopback :54321, приватный локальный backend key только в headers; ok, hash отсутствует, версия валидна; значения ключа/hash не выводились |
| Свежий admin-preview package | локальный Wrangler dry-run, exit 0; `dist/worker-packages/integrity-reviewed-20260930-r1` |
| verify-package-integrity CLI | fresh: ok/exit 0; старый пакет без inventory: missing_inventory/exit 1, ожидаемый отказ |
| readAdminPreviewRuntime | свежий принят; старый без inventory отклонён до Worker |
| Packaged isolated workerd + Chromium no-JS smoke | 17/17, exit 0, cleanup true |
| git diff --check / graphify update . | exit 0; 4030 nodes / 8195 edges. Graphify предупредил о пяти config/fixture JSON без узлов и обновлённых именах communities; это не отказ обновления |

Первый ручной probe reader был отклонён как configuration_invalid из-за неверного имени binding в диагностическом вызове; исправленный вызов с ADMIN_SUPABASE_KEY прошёл. Код reader для этого не менялся. Runtime test reader использует контролируемый loopback backend; реальный GET к PostgREST выполнен отдельно в Node, не как доказательство production.

Пакет использует прежний public staging `20260929T181759Z-46d45efe`, а не новый crawl после этой сборки. Размер Worker: **48 884 raw bytes, 12 172 gzip bytes**; site: 182 файла, 9 741 963 байта; inventory: 184 файла. Это локальные размеры, не результат Cloudflare upload. `ready: false`, `previewReady: true`, `productionReady: false`. Reader и legacy verifier остаются неподключёнными, поэтому измеренный bundle их не включает.

Smoke проверил missing bindings/public isolation, реальные public pages/search, guest/direct asset denial, sanitized login, origin/CSRF, wrong/successful password и cookie, expiry/version invalidation, private products read/search/pagination, parallel reservations/replay, browser login/logout без JS, backend outage. Использовалась отдельная тестовая БД; общий Supabase не перезапускался. Это нынешний fixture-verifier, не уже завершённая миграция ADMIN_PASSWORD.

## Что ещё не доказано

1. Нельзя подключать legacy verifier с раздельными boolean/version вызовами, пока не доказано, что пароль не проверяется по старой версии с выдачей cookie новой версии. Нужен результат проверки с версией того же прочитанного состояния и безопасный отказ при смене версии до выдачи.
2. Product mutations, media/Sharp/R2, revision/build/rollback и реальный release-compatible public snapshot — отдельные незавершённые участки.
3. SHA-256 inventory защищает от случайной порчи, не от согласованной злонамеренной подмены manifest и файлов. TOCTOU подмена после проверки остаётся ограничением.
4. Remote staging, реальные Cloudflare routing/billing/Worker Free CPU/quota и cutover не выполнялись.

## Сохранность и остановочная граница

Main не менялся: `de708af735fb0620a71d35b19c3fcf578c948c6d`.

```text
## main...origin/main [ahead 30, behind 1]
?? .codex/
?? debug.log
?? docs/CLOUDFLARE_FREE_HOSTING_MIGRATION_PLAN.md
```

Агентские ветки сохранены: Cursor `0ad07f266183833ad28cd7ddeccfca8d818e2ac2`, Claude `6e80d5dbe5e273d22a8bde75c763b34e5f4a73d8`. Собственная изолированная smoke-БД остановлена. Не выполнялись push/deploy/production/DNS/R2 mutations, `dist/site` не перезаписывался. Следующие независимые задачи: Claude — password/version proof; Cursor — локальный выбор проверенного preview-пакета и отказ без потери предыдущего выбора. Наличие задания не означает, что внешний агент уже запущен.
