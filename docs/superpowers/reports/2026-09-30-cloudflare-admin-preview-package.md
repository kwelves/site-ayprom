# Локальный admin-preview вместе с публичным сайтом

Дата завершения: 2026-09-30. Ветка: `codex/cloudflare-integration`.
Исходный HEAD: `c244e94217e6ef67950c3c78a60f776f57f53238`.
Только локальная работа. Push, deploy, DNS и production-изменений не было.

## Результат

Отдельный CLI `scripts/cloudflare/package-admin-preview.mjs` собирает проверенный публичный staging и ровно две Git-tracked тестовые HTML-страницы входа/пустой админки. Обычный публичный CLI и его конфигурация остаются прежними. Worker использует существующий auth-handler, без копии логики авторизации.

Preview получает ASSETS binding и worker-first для `/api/*`, `/product/*`, `/admin`, `/admin/*`. Manifest: `kind: admin-preview`, `previewReady: true`, `productionReady: false`, `ready: false`. Это успех локальной упаковки, не разрешение на релиз. Значения секретов не записываются в пакет: перечисляются только имена bindings.

Проверяются четыре отчёта staging, занятый output и существующие ограничения путей. Preview дополнительно отклоняет admin-коллизии (включая пустую папку и другой регистр), junction/symlink на пути входов, неотслеживаемые fixtures. Общая artifact policy применяется к объединённым файлам: секреты, запрещённые пути, карты исходников, регистровые коллизии, 20 000 файлов и 25 MiB на файл. Ошибки не раскрывают содержимое входа. Небезопасные входы отклоняются до создания output.

`local-admin-auth-smoke.mjs --package <папка>` проверяет именно `worker.js` и `site/` из готового пакета, не исходный Worker. Он сначала валидирует preview manifest/config, затем создаёт собственную временную Supabase, пользователя и конфигурацию вне пакета. Прежний standalone fixture-режим сохранён.

## TDD и проверки

- RED упаковки: пять новых кейсов падали из-за отсутствия `packageAdminPreview`. Дополнительно два прежних теста упёрлись в 60-секундный timeout Wrangler; это не засчитано как успешная проверка. Повторные целевые и полный прогоны прошли.
- RED runtime-validator: отсутствовал новый модуль. После реализации его пять тестов прошли.
- Целевые пакет/runtime: 24/24; отдельно перед добавлением трёх защитных кейсов пакет/runtime/прежний smoke: 25/25.
- `npm run check`: exit 0, 154 файла passed + 1 skipped, **1206 тестов passed + 4 skipped**. Lint, typecheck, цвета (294 файла) прошли. В jsdom остаются известные сообщения о неподдерживаемой навигации; браузерная проверка выполнена отдельно.
- `npm run build` с `AYPROM_STATIC_BUILD=1`: exit 0, 36/36. Первоначальная ошибка TypeScript в новом тесте исправлена до успешного повтора.
- Настоящий `local-static-producer.mjs`: **90/90 маршрутов**, failed 0, pendingAliases 12; собственный Next-процесс убран (`cleanup.ok: true`).
- Локальный Wrangler `deploy --dry-run`, вызванный упаковщиком: exit 0. Никакой загрузки в аккаунт.
- Изолированный packaged smoke: **15/15**, `ok: true`, `cleanup: true`. Нет admin bindings → admin 503, health/search 200; с bindings — guest redirect, запрет прямых HTML, CSRF, неверный пароль, cookie tamper/expiry, параллельные брони и replay, отзыв по версии, браузерный login/logout без JavaScript, отказ backend.
- Отдельный packaged workerd + только чтение общей локальной БД: health 200, поиск `q=shaft` 200 с пустой выдачей, `/product/ay-gp110` 308 на ожидаемую страницу, целевая HTML-страница 200.
- CLI с неизвестным `--deploy`: exit 1, `invalid_arguments`, без действий.
- `git diff --check`: чисто. Graphify обновлён; предупреждение о пяти файлах без AST-узлов не мешает графу.

## Артефакт и повторный запуск

Staging: `dist/staging/20260929T181759Z-46d45efe`.
Preview: `dist/worker-packages/admin-preview-20260930-46d45efe`.
Размер Worker: **36 476 байт**, gzip **8 975 байт**. Это локальный размер, не измерение Cloudflare CPU/квоты.
Assets: **182 файла**, **9 741 890 байт**.
Отчёт smoke: `dist/local-admin-auth-smoke/report.json` (перезаписывается следующим smoke).

```powershell
node scripts/cloudflare/package-admin-preview.mjs --staging dist/staging/20260929T181759Z-46d45efe --package dist/worker-packages/<новое-имя>
node scripts/cloudflare/local-admin-auth-smoke.mjs --package dist/worker-packages/<новое-имя>
```

Вторая команда запускает и затем убирает только собственный изолированный стек на 564xx. Общий `site-for-kirsan` на 543xx не перезапускается. Уже существующий output не перезаписывается. `dist/site` не менялся. Пакет и staging игнорируются Git; это локальные диагностические артефакты.

## Что НЕ завершено

- Оболочка админки тестовая и пустая: настоящие CRUD, загрузки, смена пароля и admin UI не перенесены.
- Production `ADMIN_PASSWORD`, Supabase, R2 и Vercel не переключались. В браузерной публичной сборке остаётся намеренно непригодный для production Supabase origin `static-build.invalid`.
- Проверка путей защищает от уже существующих junction/symlink, но не от враждебной одновременной подмены каталогов между проверкой и файловой операцией.
- Отчёты staging проверяются как локальные входы; криптографической привязки отчётов к каждому байту нет. Не использовать изменённый после проверки staging как доказательство релиза.
- Удалённый staging, реальные bindings, Worker Free CPU, production routing и rollback/cutover ещё не проверены.

Следующий локальный участок: спроектировать перенос реального admin API/UI отдельными ограниченными слайсами, начиная с чтения данных; не объявлять preview готовой админкой.
