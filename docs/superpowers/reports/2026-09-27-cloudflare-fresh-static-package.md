# Свежая локальная сборка Cloudflare Static Assets + Worker — 2026-09-27

Исходный commit: `49ec35d496bd9a49c62ce749d007072cfef83f76` в `codex/cloudflare-integration`. Это диагностический прогон без deploy, push, изменений DNS, `dist/site` или production-сервисов. Уже работавший Supabase на `127.0.0.1:54321` использовался только для чтения публичных данных. Его publishable key передавался процессам через окружение и не сохранялся в отчётах.

## Результат

- `npm run build` с `AYPROM_STATIC_BUILD=1`, локальным источником данных и диагностическими browser bindings: exit 0, 36/36 задач генерации страниц.
- `node scripts/cloudflare/local-static-producer.mjs`: exit 0; новый `dist/staging/20260927T140325Z-a8afa5c8`, 90 маршрутов записано, 0 ошибок, 12 alias ожидают проверки; дочерний Next-сервер остановлен.
- `node scripts/cloudflare/package-worker-assets.mjs`: exit 0; отдельный `dist/worker-packages/fresh-20260927-a8afa5c8`, 180 статических файлов (9 740 058 байт). Worker: 15 501 байт без сжатия, 4 150 байт gzip.
- `local-browser-probe.mjs` на свежем staging: exit 0; 7/7 классов статических заголовков, 12/12 alias redirect, поиск и повторный поиск после перезагрузки, открытие товара клавиатурой и кликом по изображению. `pageErrors=0`, `uncapturedPrefetches=0`, `localHttpErrors=[]`.
- Отдельный локальный workerd с готовым пакетом и тестовым PostgREST: health 200, поиск 200, `/product/ay-gp110` → 308 на ожидаемый canonical, `/catalog` → HTML 200.

## Граница результата

Сборка намеренно содержит `https://static-build.invalid` и `sb_publishable_diagnostic_only` как клиентские bindings. Пакет нельзя публиковать как сайт. Не проверены удалённый Cloudflare staging, реальная конфигурация Worker bindings, авторизация админки, Worker Free CPU и переключение DNS. Vercel остаётся rollback-origin.
