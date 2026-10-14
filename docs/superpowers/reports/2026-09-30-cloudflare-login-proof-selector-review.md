# Review: password/version proof и local preview selector

Дата: 2026-09-30. Только локальная integration-ветка, main и агентские worktrees не редактировались.
Начальный HEAD: `0e778bd0bb76ebb340a3533856fba4cf4558daa4`.

## Claude: принят с дополнительным исправлением

`44a9574804e4a3824831c44ddeb361fa416948fd` → `8f53e85`.
Новый optional verifyPasswordWithVersion возвращает версию того же состояния, по которому проверяется пароль. Handler не использует boolean fallback при наличии нового порта, завершает reservation один раз и сверяет версию перед выпуском cookie. При несовпадении/ошибке cookie отсутствует. Старые адаптеры без нового порта сохранены; worker.ts, Next, public search и SQL не изменены.

Codex обнаружил дополнительную границу: readCredentialState может вернуть общий изменяемый объект. Verifier читал sessionVersion после асинхронной криптографии и мог переименовать проверку старого пароля новой версией. Текущий HTTP reader возвращает отдельный JSON объект, поэтому этот сценарий не является доказанным production-эксплойтом; это дефект гарантии framework-neutral порта до его подключения.

Два новых теста: RED 2 failed / 48 passed. Первый меняет shared state из env reader; второй меняет hash/version из deriveBits seam во время настоящего PBKDF2 и воспроизводит cookie версии 3 по старому hash. Исправление: скопировать passwordHash/sessionVersion в readState до crypto await. GREEN: 4 focused файла, 99 passed, включая прежние handler/verifier и настоящий workerd.

Дополнительно workerd fixture проверяет shared-env-mutation: первая проверка относится к версии 1, сверка видит 2, cookie нет. Расширенный runtime test отдельно прошёл 1/1 после общего check. Сессия, устаревшая после последней сверки, всё ещё отклоняется следующим защищённым запросом; атомарность чтения БД и отправки cookie не заявляется.

## Cursor: НЕ интегрирован

`593bbb7fbdbe6544efd4b08acfe59bfef86b1e1e`, чистая агентская ветка сохранена.
Независимый Node harness читает модуль из worktree Cursor; создаёт только собственные временные учебные пакеты и state. Реальные пакеты и dist/site не менялись.

1. select A→A с правильным generation возвращает ok, записывает current===previous. Следующий status даёт selection_invalid/malformed.
2. State generation=Number.MAX_SAFE_INTEGER принимается; следующий select записывает 9007199254740992, возвращает ok, следующий status даёт malformed.
3. Контролируемые ошибки rename: первая замена EPERM, перенос старого state в backup успешен, установка нового state и восстановление backup дают EPERM. Результат selection_write_failed, прежнего selection.json нет, status объявляет generation 0. Даже при успешном восстановлении fallback создаёт окно без selection.json. Это не атомарная замена и не соответствует заданию.

Нужно убрать backup/restore fallback, который перемещает текущий выбор: неуспешная атомарная замена обязана оставить старый файл. A→A сделать валидным no-op после проверки поколения/кандидата; overflow отклонять до записи. Тесты должны воздействовать на реальную ветку rename, а не только на целиком заменённый commit callback. Также добавить явный foreign-lock тест.

## Независимые проверки integration

| Gate | Результат |
|---|---|
| npm run check | exit 0, lint/typecheck/colors (299 файлов), 167 files passed / 1 skipped; 1408 tests passed / 4 skipped |
| npm run build, AYPROM_STATIC_BUILD=1 | exit 0, 36/36; существующий loopback Supabase/public key, диагностические browser bindings |
| packageAdminPreview | local Wrangler 4.135.0 dry-run, exit 0; новый каталог login-proof-reviewed-20260930-r1 |
| verify-package-integrity CLI | ok, exit 0 |
| local-admin-auth-smoke на свежем пакете | 17/17, exit 0, workerd + Chromium no-JS, cleanup true |
| Расширенный workerd proof | 1/1, exit 0, без Supabase |
| lint / typecheck после runtime дополнения, diff-check | exit 0 |
| graphify update . | exit 0, 4068 nodes / 8277 edges; предупреждения о пяти config/fixture JSON без узлов, не отказ обновления |

Первый ручной build был отклонён из-за опечатки в имени временной переменной окружения для public key (static_build_supabase_bindings_incomplete). Правильный AYPROM_STATIC_BUILD_SUPABASE_PUBLISHABLE_KEY позволил повторить build успешно; код/файлы env не менялись. После расширения runtime-only fixture повторены lint/typecheck и diff-check.

Свежий пакет: `dist/worker-packages/login-proof-reviewed-20260930-r1`, Worker **49 895 байт / gzip 12 392 байта**, 182 static assets / 9 741 963 байта, inventory 184 файла. Public staging переиспользован из прежнего проверенного crawl `20260929T181759Z-46d45efe`, это не новый public snapshot. `ready:false`, `previewReady:true`, `productionReady:false`. Legacy reader/verifier пока не входят в bundle; packaged smoke проверяет нынешний Supabase Auth fixture путь. Новый proof отдельно проверен workerd, а не объявлен подключённым.

## Границы и следующий шаг

Cloudflare Workers best-practices/wrangler и Supabase skills использованы для проверки local-only runtime, отсутствия секретов в config/выводе и сохранения границ public/admin. Актуальные Workers types 5.20260930.1 и Wrangler 4.135.0 подтверждены; platform API/config в этой волне не менялись.

Следующее независимое задание Claude: reusable reserve/finish ports + legacy-admin composition без GoTrue email/user id, ещё без Worker wiring. Cursor: три замечания selector + fault injection. Codex затем подключает reviewed legacy ports к локальному Worker и меняет собственный isolated smoke под настоящий credential-row/env сценарий. Product mutations/media/revision/rollback, release-compatible public snapshot, remote CPU/quota/routing и cutover остаются незавершёнными.

Не выполнялись push/deploy/DNS/production/R2 mutations. Общий Supabase не перезапускался, собственный smoke stack остановлен. Main неизменен: `de708af735fb0620a71d35b19c3fcf578c948c6d`.

```text
## main...origin/main [ahead 30, behind 1]
?? .codex/
?? debug.log
?? docs/CLOUDFLARE_FREE_HOSTING_MIGRATION_PLAN.md
```
