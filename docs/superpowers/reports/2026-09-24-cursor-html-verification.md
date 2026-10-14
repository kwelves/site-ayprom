# Cursor: проверка HTML и SEO в staging

- Дата: 2026-09-24
- Ветка: `codex/cursor-canonical`, исходный HEAD `7ebd81fe564d40781909e56514c8f22a156275b8`
- Статус: локальный этап. Без push, merge, deploy. Staging по-прежнему не готовый сайт.

После скачивания страниц и копирования файлов, и только если само скачивание прошло без ошибок, producer проверяет HTML-документы по route manifest. `robots.txt` и `sitemap.xml` не проверяются как страницы.

Для каждого документа: ровно один canonical из манифеста, непустой title, один логический H1, те же типы JSON-LD, что в манифесте, и индексность по манифесту. У 404 обязателен `noindex`. Ссылка на localhost, preview-домен или `/_next/image` даёт отказ `forbidden_url`; сам адрес в отчёт не попадает.

Отчёт пишется в `meta/verification-report.json` этого запуска. Код отказа: `seo_verification_failed`. `dist/site` не меняется. Адреса вида `/product/...` остаются в отчёте как `pending`: их перенаправление ещё не считается работающим.

Не входит в этот этап: проверка всех внутренних ссылок, workerd, настоящий `next build`/`next start`, перенос staging в `dist/site`.
