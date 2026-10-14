# Приёмка исправленного selector и legacy admin ports

Дата: 2026-09-30. Только локальная ветка `codex/cloudflare-integration`.
Исходный HEAD: `72ad6d80bc09e57c9c789a3499955b1238d4b971`.

## Принятые изменения

- Cursor `593bbb7` + `06bef22` → `88aa1ce` + `eb45a15`: локальный выбор проверенного admin-preview, без запуска Worker, без изменения пакетов и `dist/site`.
- Claude `1610b20` → `5a1533d`: reusable attempt ports и неподключённая фабрика legacy admin ports. Проверенный пароль и его версия остаются связанными; env fallback разрешён только при пустой строке credentials, но не при сбое чтения/существующем хеше.

Основная папка и агентские worktrees не редактировались. Next/Vercel auth и public search не переключались. Новый verifier/reader/factory всё ещё НЕ подключены к `worker.ts`, preview или packaged smoke. Прежний Supabase Auth adapter сохранён, reserve/finish используют общий код.

## Независимое воспроизведение selector

Повторён Node harness против исходника Cursor, с собственными временными учебными пакетами и выбором, не с рабочим selection.json.

1. A→A: generation 1, previous null, последующий status валиден, no-op.
2. MAX_SAFE_INTEGER: `generation_overflow`; прежняя запись остаётся валидной и неизменной.
3. Ошибка реального rename через узкий I/O seam: `selection_write_failed`, oldSelectionPresent true, oldBytesPreserved true, missingWindow false.

Harness скорректирован под новый seam: модуль захватывает rename в defaultIo, поэтому одной поздней подмены fs.renameSync недостаточно для инъекции отказа. Два первых запуска harness были отклонены из-за неверного cwd/аргумента; это ошибки запуска проверки, не дефекты selector. Итоговый корректный прогон подтвердил все три сценария.

Гонка подмены пакета или каталога после проверки остаётся ограничением. Inventory защищает от случайной порчи, не является подписью. Локальный выбор пакета не означает откат БД или production-публикации.

## Проверки integration

| Проверка | Результат |
|---|---|
| Focused: legacy factory/runtime, прежний adapter, HTTP boundaries, selector | exit 0, 5 файлов, 75/75 |
| npm run check | exit 0; lint/typecheck/colors (300 файлов); 170 файлов passed, 1 skipped; 1463 tests passed, 4 skipped |
| npm run build, AYPROM_STATIC_BUILD=1 | exit 0, 36/36, существующий loopback Supabase и публичный ключ, диагностические browser bindings |
| packageAdminPreview | локальный Wrangler 4.135.0 dry-run, exit 0, новый каталог legacy-ports-reviewed-20260930-r1 |
| verify-package-integrity CLI | exit 0, ok true |
| local-admin-auth-smoke на новом пакете | exit 0, 17/17; настоящий workerd, собственный isolated Supabase, Chromium без JavaScript; cleanup true |
| git diff --check | exit 0; только предупреждения LF/CRLF |
| graphify update . | exit 0, 4142 nodes / 8432 edges; прежние пять JSON без узлов и изменение labels не являются отказом обновления |

jsdom печатает известное сообщение Not implemented: navigation; тесты не падают. Оно не используется как доказательство браузерной навигации.

Пакет: `dist/worker-packages/legacy-ports-reviewed-20260930-r1`; Worker **50 545 байт / gzip 12 496 байт**, 182 assets / 9 741 963 байта, inventory 184 файла. `ready:false`, `previewReady:true`, `productionReady:false`. Public staging переиспользован из `20260929T181759Z-46d45efe`; успешный новый Next build не означает новый crawl публичных страниц.

## Следующий шаг и оставшиеся gates

Codex: подключить reviewed legacy ports к локальному Worker, убрать обязательность fixture email/user id, затем перепроверить настоящий пакет на собственном isolated Supabase с credential-row/env сценариями. Не менять production пароль, SQL и legacy Next adapter.

Возможные независимые участки: Cursor — read-only разрешение выбранного пакета с повторной integrity-проверкой непосредственно перед будущим запуском; Claude — композиционные workerd тесты смены версии во время finish и последующего отказа защищённого запроса. Это ещё не запущенные задания.

Не закрыты: admin mutations/media/revision, свежий release-compatible public snapshot, remote CPU/quota/routing, production cutover. PBKDF2 600000 итераций сохранён; локальный workerd не доказывает соответствие Worker Free CPU.

Не выполнялись push/deploy/DNS/production/R2 mutations. Общий Supabase не перезапускался; собственный smoke stack остановлен. Smoke напечатал предупреждение MODULE_TYPELESS_PACKAGE_JSON для Node-загрузки session-codec.ts, но завершился успешно; package.json ради него не менялся. Main неизменен: `de708af735fb0620a71d35b19c3fcf578c948c6d`.

```text
## main...origin/main [ahead 30, behind 1]
?? .codex/
?? debug.log
?? docs/CLOUDFLARE_FREE_HOSTING_MIGRATION_PLAN.md
```
