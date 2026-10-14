# Подключение legacy password auth к локальному Worker

Дата: 2026-09-30. Исходный integration HEAD: `4b6c14a59d64d56e688d45c0cdea66e132bf4e55`.
Ветка: `codex/cloudflare-integration`. Только локальная подготовка, не production rollout.

## Приёмка агентов

- Cursor `63da2b2` → `57b731b`: read-only resolveSelectedAdminPreview с повторной проверкой выбора и existing integrity/runtime validation, без запуска Worker.
- Claude `9956b87` → `3565c46`: реальные handler/reader/verifier/ports в workerd; backend меняет версию внутри finish RPC, после выдачи сессии либо отказывает при повторном чтении. Прежний runtime test совместим с расширенным entry. Независимый прогон Codex: 3 файла, 9/9. Пять отрицательных мутаций описаны Claude; Codex повторно production-код для них не ломал.

Codex нашёл небольшое несовпадение контракта Cursor: selector допускает имя pkg..a, а resolver отклонял любое вхождение двух точек. Независимый RED подтвердил отказ при валидном выборе. Убран запрет на точки внутри basename; разделители пути и dot segments по-прежнему отвергаются. Новый regression test проходит. Пакеты и рабочий selection.json при этой проверке не изменялись.

## Изменения Codex

- worker.ts передаёт createLegacyAdminPorts в настоящий createAdminHandler, включая verifyPasswordWithVersion. Каждый запрос получает свои ports, без глобального кэша credentials.
- ADMIN_AUTH_EMAIL/ADMIN_AUTH_USER_ID больше не обязательны и не используются. ADMIN_PASSWORD необязателен при существующем хеше, но нужен для входа при пустой credential row. ADMIN_SUPABASE_KEY/HMAC/ASSETS остаются обязательными для admin routes.
- Public search по-прежнему использует только SUPABASE_PUBLISHABLE_KEY и прежний RPC. Секретный ключ не попадает в публичный запрос даже при настроенной админке.
- Preview manifest отражает новый набор requiredBindings и optionalBindings: ADMIN_PASSWORD. Пакет не содержит значений bindings.
- Собственный isolated smoke больше не создаёт Supabase Auth пользователя. Сначала проверяет пустую admin_credentials и env login; затем сохраняет отдельный случайный PBKDF2 hash версии 2 только в собственной тестовой БД. Хеш получен через независимый Node pbkdf2Sync, 600000 итераций.
- Smoke подтверждает: env-пароль больше не принимается при хеше, старая сессия отзывается, новый пароль работает в браузере без JS; после перезапуска собственного Worker без ADMIN_PASSWORD вход по хешу продолжает работать. Остановка своей БД закрывает shell/products/login, cookie при login outage не выдаётся.
- HTTP runtime gates адаптированы к новому Worker: redirect/oversized fault проверяется на обоих чтениях credential row, finish stall закрывает вход, redirect sink не получает запросов. Legacy Supabase Auth adapter и его самостоятельные тесты сохранены.

Next/Vercel код, SQL migrations, production auth/данные, R2, основная папка и агентские worktrees не менялись. Локальная вставка credential row в smoke — тест сценария, а не реализация API смены пароля (ADM-04).

## TDD и проверки

Общий собственный RED: 5 failed / 28 passed, 3 файла. Отказы — два login сценария без email/user id, credential outage, preview manifest с прежними обязательными bindings, валидное dotted имя пакета. GREEN: 33/33.

Первый общий check и build остановились на TS2322 в новом тестовом env helper (необязательный пароль). Ошибка типизации исправлена, команды повторены; первый отказ не считается успешной проверкой.

| Gate | Результат |
|---|---|
| npm run check, повтор после исправления type helper | exit 0; lint/typecheck/colors (300 файлов), 172 files passed / 1 skipped, 1476 tests passed / 4 skipped |
| npm run build, AYPROM_STATIC_BUILD=1 | exit 0, 36/36; чтение существующего loopback Supabase, public key и диагностические browser bindings |
| packageAdminPreview | exit 0, локальный Wrangler 4.135.0 dry-run, новый каталог legacy-auth-wired-20260930-r1 |
| verify-package-integrity CLI | exit 0, ok true |
| packaged isolated workerd/Supabase/Chromium smoke | exit 0, 19/19, cleanup true |
| git diff --check | exit 0; только LF/CRLF warnings |
| graphify update . | exit 0, 4180 nodes / 8497 edges; прежние пять JSON без узлов и изменение labels — предупреждения, не отказ |

Worker **57 502 байта / gzip 14 170 байт**. 182 assets / 9 741 963 байта, inventory 184 файла. Bundle содержит credential reader и PBKDF2 scheme; endpoint /auth/v1/token отсутствует. Public staging переиспользован из `20260929T181759Z-46d45efe`, это не новый public crawl. `ready:false`, `previewReady:true`, `productionReady:false`.

Smoke: `dist/local-admin-auth-smoke/report.json`, никаких паролей/ключей/hash/cookie в отчёте. Собственный test stack остановлен; общий стек не перезапускался. Известное Node MODULE_TYPELESS_PACKAGE_JSON предупреждение не является отказом smoke; package.json ради него не менялся.

## Ограничения и следующий участок

Локальная совместимость входа проверена, но админка пока содержит shell и read-only список товаров, не полный production UI/CRUD. Нет Worker API смены пароля, продуктовых mutations, media pipeline или revision/publication orchestration. Проверка SHA-256 не подпись; TOCTOU после последней проверки файлов остаётся. Credential version может измениться после последней сверки; cookie несёт проверенную версию и отвергается следующим защищённым запросом.

Worker Free CPU для PBKDF2, remote quota/routing/bindings и cutover не доказаны локальным runtime. Итерации не ослаблялись. Актуальные Cloudflare types 5.20260930.2, pinned Wrangler 4.135.0 и рекомендации Workers/Supabase использованы для сохранения локального режима, per-request state, HTTP limits и server-only secrets.

Следующий логичный участок: framework-neutral credential CAS writer для последующей смены пароля либо первая атомарная product mutation с auth/origin/audit. Их подключение и реальные writes — только на собственной тестовой БД. Push/deploy/DNS/production mutations не выполнялись.
