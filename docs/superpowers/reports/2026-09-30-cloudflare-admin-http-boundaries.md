# Ограниченные сетевые вызовы Worker-авторизации

Дата: 2026-09-30. Ветка `codex/cloudflare-integration`.
Исходный HEAD: `1c53c4546723bba2d8c96ea2aa8594667706cb95`.
Только локальная работа. Production, DNS, R2, Vercel, main и чужие worktrees не изменялись.

## Результат

Все четыре backend-канала локальной Worker-авторизации (reserve, finish, Supabase Auth password verification, credential version) используют общий `requestAdminJson`:

- общий срок одного HTTP-вызова, включая чтение тела, — 10 секунд;
- максимум 65536 байт JSON, подсчёт по входным байтам, не длине строки;
- `redirect: manual`; любые 3xx и уже перенаправленный ответ отклоняются;
- запрет URL userinfo вместо молчаливого удаления username/password;
- поток отменяется при oversized/invalid/status/timeout; отдельно отменяется ответ, пришедший после срока;
- timer/listeners освобождаются; нет singleton request state;
- ошибки содержат только прежние фиксированные сообщения, без backend payload, пароля, токенов или ключа;
- Auth `400 invalid_credentials` сохраняет прежний смысл «неверный пароль», остальные ошибки не превращаются в разрешение входа.

Это не меняет verifier на production. Legacy Next/Vercel auth, public search, SQL, password format и admin UI не редактировались. Изменение навеяно правилами навыков Cloudflare/Supabase о bounded streaming и server-only keys, затем проверено на реальном runtime.

## RED → GREEN

- Новый boundary-набор на прежнем adapter: **9 failed / 4 passed**. Не было manual redirect/deadline signal, oversized open streams не завершались до EOF, URL userinfo не отклонялся перед I/O.
- Новый transport-набор первоначально не импортировался (модуль отсутствовал).
- После реализации transport/boundary/прежний Supabase adapter: **26/26**.
- Дополнительный RED: запоздавший response body не отменялся (**1 failed / 6 passed**). После исправления тот же тест прошёл.
- Финальные focused boundary/transport/adapter/real-workerd: **28/28**, exit 0.
- Настоящий workerd сначала успешно выпустил локальную cookie, затем fault injection по всем четырём каналам доказал отказ на 307 и oversized JSON, отсутствие cookie на ошибке и **0** запросов к отдельному loopback redirect sink. Незавершённый finish-response остановился по настоящему 10-секундному лимиту. API сессии при сбое version lookup — 503.

## Итоговые проверки

- Финальный `npm run check`: exit 0; lint/typecheck/check:colors (297 файлов) прошли; **160 файлов passed + 1 skipped, 1246 тестов passed + 4 skipped**. Известное сообщение jsdom о неподдерживаемой навигации остаётся, настоящий браузер проверен отдельно.
- `npm run build` с `AYPROM_STATIC_BUILD=1`: exit 0, 36/36; повтор после late-response fix также прошёл. Использованы временные локальные bindings, не production env.
- Локальный Wrangler dry-run через упаковщик: exit 0.
- Packaged isolated Supabase + workerd + Chromium без JavaScript: первый и финальный пакеты прошли **17/17**, exit 0, cleanup true. Финальный project ID `ayprom-admin-auth-e85956549f`; ни один его контейнер не остался. Node выводит прежнее предупреждение MODULE_TYPELESS_PACKAGE_JSON при импорте session-codec.ts; package.json ради предупреждения не менялся.
- Targeted ESLint новых файлов: exit 0 до дополнительного late-response fix; финальный общий check включает последнюю правку.
- `git diff --check`: чисто, только предупреждения LF/CRLF.
- Graphify обновлён перед checkpoint.

## Артефакты

Публичный staging переиспользован: `dist/staging/20260929T181759Z-46d45efe` (не новый snapshot).
Финальный пакет: `dist/worker-packages/admin-http-20260930-r2`.
Worker **48884 байта**, gzip **12172 байта**; 182 assets, 9741963 байта.
Manifest остаётся `ready: false`, `previewReady: true`, `productionReady: false`.
Это локальный размер bundle, не измерение CPU или удалённый deploy.

```powershell
node scripts/cloudflare/package-admin-preview.mjs --staging dist/staging/20260929T181759Z-46d45efe --package dist/worker-packages/<новое-имя>
node scripts/cloudflare/local-admin-auth-smoke.mjs --package dist/worker-packages/<новое-имя>
```

Первый диагностический пакет `admin-http-20260930` сохранён в ignored dist. Стек smoke собственный, на 564xx; общий стенд 543xx не перезапускается. `dist/site` не менялся.

## Остаток подготовки и координация

Подготовлен план `docs/superpowers/plans/2026-09-30-cloudflare-preparation-closure.md` с отдельными критериями локальной подготовки и внешних release gates.

Готовы задания для передачи владельцем, но запуск агентов не предполагается без фактического результата:

- Cursor / Grok 4.7 High: `docs/superpowers/agent-tasks/2026-09-30-cursor-package-integrity.md` — SHA-256 inventory готового пакета + read-only проверка перед runtime. Защита от случайной порчи, не цифровая подпись.
- Claude / Sonnet 5 High: `docs/superpowers/agent-tasks/2026-09-30-claude-legacy-password-verifier.md` — неподключённый injected verifier нынешней схемы ADMIN_PASSWORD/hash и отдельный golden workerd gate. Hash path нельзя объявить готовым по Node-тестам или ослабить PBKDF2 ради Worker.

До их review/integration и оставшихся admin/media/publication gates вся подготовка **не завершена**. Проверки локальной авторизации не дают разрешения на DNS/deploy или изменения production-пароля.

Текущее ограничение: размер/тайм-аут введены для Auth/RPC/version каналов; product reader сохраняет свой прежний 1 MiB и 10 s fetch limit. Общий срок всего login flow может включать несколько последовательных HTTP-вызовов, это не единый 10-секундный deadline для всего HTTP-handler. Worker Free CPU остаётся отдельным недоказанным remote gate.

## Проверенные источники

- [Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) — bounded response processing.
- [Cloudflare Request](https://developers.cloudflare.com/workers/runtime-apis/request/) — redirect и sensitive header handling; фактическая совместимость проверена pinned workerd.
- [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api) — разделение public/private keys.
- Supabase changelog прочитан; релевантных этому HTTP adapter breaking changes не найдено. API types проверены по latest `@cloudflare/workers-types` **5.20260930.1**, без изменения dependency manifest.
