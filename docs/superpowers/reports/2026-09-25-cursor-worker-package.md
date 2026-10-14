# Локальный пакет тонкого Worker и Static Assets

- Дата: 2026-09-27
- Ветка: `codex/cursor-worker-package`
- Статус: локальная упаковка. Без аккаунта Cloudflare, deploy, push, DNS и production.

Папка результата должна быть новым каталогом внутри `dist/worker-packages`. Команда не стирает уже существующую папку и не пишет вне этой области. Корень репозитория, `dist/site`, сам staging и внешний каталог отклоняются. Junction и symlink на пути тоже отклоняются, файлы при отказе не меняются.

Перед записью читаются те же четыре отчёта, что и у локальной проверки сайта: `crawl-report.json` (`failed` = 0 и `written` = `routes`), `verification-report.json`, `sitemap-verification.json`, `link-verification.json` (`ok` = true). Нет отчёта или отчёт отрицательный — пакета нет.

Сборку делает локальный Wrangler `deploy --dry-run`, не самописный разбор TypeScript. Карта исходников в пакет не копируется.

```powershell
node scripts/cloudflare/package-worker-assets.mjs --staging dist/staging/<run> --package dist/worker-packages/<новое-имя>
```

Измеренный учебный bundle: **13360 байт**, gzip **3660 байт**.

Локальный workerd с тестовыми подстановками ответил: health 200, поиск 200, алиас товара 308. Это не удалённый smoke и не auth. Секреты production в пакет не входят.
