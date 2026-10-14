# Локальный прототип авторизации тонкого Cloudflare Worker — 28.09.2026

## Итог и граница

В ветке `codex/cloudflare-integration` реализован отдельный локальный вход в пустую оболочку админки: Supabase Auth проверяет один тестовый аккаунт, приватные RPC бронируют и учитывают попытки, Worker выдаёт HMAC-cookie и допускает к `/admin` только с действующей сессией и актуальной версией учётных данных. Исходный Next/Vercel login оставлен legacy adapter; production `ADMIN_PASSWORD`, production Supabase, R2, DNS и Vercel не менялись. Push, deploy и удалённый Cloudflare staging не выполнялись.

Это **не готовая к публикации админка**: нет реальных страниц/CRUD, password change, интеграции fixture в собранный static site и production-перехода credentials. Старый пакет `fresh-20260927-a8afa5c8` не объявляется admin-ready.

## Реальные локальные проверки

- `node scripts/cloudflare/local-admin-auth-smoke.mjs` — второй прогон exit 0, 13/13 проверок, `cleanup: true`. Скрипт создал уникальный Supabase-проект `ayprom-admin-auth-654a185102` на портах 5642x, скопировал миграции без seed, создал только тестового Auth-пользователя и временную запись версии, запустил настоящий локальный Wrangler/workerd и Playwright Chromium с отключённым JavaScript. Собственные контейнеры и процессы после прогона остановлены; общий проект `site-for-kirsan` на 5432x не перезапускался и не изменялся.
- После независимого review и исправления таймаута готовности выполнен ещё один полный прогон: проект `ayprom-admin-auth-dcad8b23ae`, exit 0, 13/13, `cleanup: true`. Отдельный RED→GREEN тест с реальным дочерним процессом подтвердил его остановку при таймауте.
- Проверены гость и прямой путь к HTML, безопасное сообщение login и `no-store`, отсутствие/чужой `Origin`, неверный и верный пароль, cookie gate и подделка, просроченный токен, параллельные брони (ровно 3 разрешены из 4) и повторное завершение брони, отзыв старой сессии после повышения `session_version`, переходы login/logout в браузере без JavaScript, отказ при недоступности backend.
- Финальный `npm run check` — exit 0: 153 test files passed, 1 skipped; 1192 теста passed, 4 skipped. В ходе работы стандартные полные прогоны дважды упирались в 5-секундные таймауты разных старых CLI-тестов под высокой параллельной нагрузкой; оба целевых теста проходили отдельно. Для package-теста с настоящим Wrangler установлен лимит 20 секунд, а штатный `npm test` теперь использует уже принятый в команде `--maxWorkers=2`. После этого полный check прошёл. Сообщения jsdom `Not implemented: navigation` не считаются браузерной проверкой и не валили suite.
- `npm run build` без `.env.local` сначала ожидаемо упал на `Invalid URL` при загрузке `next.config.ts`. Повтор с временными локальными env из read-only `supabase status` общего стенда, `AYPROM_STATIC_BUILD=1` и случайными тестовыми admin-секретами завершился exit 0, 36/36 статических страниц. Эти значения не записывались в файлы или отчёт.
- `node .wrangler/tools/wrangler-4.135.0/node_modules/wrangler/bin/wrangler.js deploy --dry-run --config wrangler.admin-local.jsonc --outdir dist/admin-auth-dry-run` — exit 0, без загрузки в Cloudflare. Локальный `worker.js`: **32 939 байт**, gzip **8 435 байт**. Это измерение локального файла, не размера после upload и не Worker Free CPU. Dry-run создал и локальную source map; её нельзя включать в будущий публикуемый пакет.

Первый real-service прогон тоже прошёл все 13 проверок, но закончился `cleanup: false`: Windows ещё держал служебные SQLite-файлы Wrangler. Временный JSON-конфиг с ключами удалён. Остался каталог `C:\Users\user\AppData\Local\Temp\ayprom-admin-auth-hpEgSv\wrangler-state` (только служебные SQLite-файлы, которые могут содержать диагностические данные); shell-политика не разрешила рекурсивное удаление извне worktree. Повторный прогон после ожидания закрытия дескрипторов завершил уборку собственного нового каталога успешно. Старый каталог нужно удалить вручную после проверки, что в нём нет нужных данных; не считать его частью проекта. Контейнеров `ayprom-admin-auth-*` после теста нет.

Независимое read-only review не нашло подтверждённого обхода auth-gate. Предварительное подозрение на `/%61dmin` снято после проверки канонического redirect локального asset router. Один существенный дефект cleanup исправлен с RED→GREEN тестом. Отложены три небольших пункта до отдельного hardening: прежний legacy-ответ при отсутствующем `ADMIN_SESSION_SECRET`, независимый golden token в тесте и замена текущего SHA-256 attempt key на HMAC, как изначально требовал план. Эти пункты не следует молча считать production-ready.

## Что дальше

1. Отдельно решить, как безопасно включить проверенную оболочку и Worker bindings в реальный static-producer/package. Текущий `wrangler.admin-local.jsonc` намеренно только для fixture.
2. Реализовать и проверить admin API/CRUD, смену пароля и policy отзыва сессий; logout сейчас очищает cookie в браузере, но как у stateless-токена его старая копия действует до expiry или повышения версии.
3. На изолированном remote staging проверить реальные секреты/bindings, Worker Free CPU, маршрутизацию и браузерные сценарии. Только затем обсуждать production cutover и Vercel rollback.

Состояние Git и окончательный HEAD фиксируются в handoff сессии после локального checkpoint. Ничего не отправлено и не развёрнуто.
