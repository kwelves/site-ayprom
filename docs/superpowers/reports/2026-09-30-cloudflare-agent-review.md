# Приёмка результатов Claude и Cursor

Дата: 2026-09-30. Только локальная работа в `codex/cloudflare-integration`.
Исходная точка Codex: `96590a6673f6de148f4823fe61739c2659538699`.
Основной checkout и чужие worktrees не редактировались. Push/deploy/DNS/production mutations не выполнялись.

## Claude: принят, но не подключён к входу

Проверена чистая ветка `codex/claude-legacy-password-verifier`, HEAD `2c7bd48ab093573ceaeb9e4a8aa2227f89a8d5bd`. Шесть файлов локально перенесены в integration коммитом `c1e56c8758439ff3dc400e2c635734e24d8fc6dc`.

- Повторно использованы существующие constant-time SHA-256 comparison и PBKDF2 verifier, алгоритм и 600000 итераций не менялись.
- Fallback на ADMIN_PASSWORD допускается только для явно полученного `passwordHash: null`. Reader outage, invalid state, unsafe env и crypto failure не разрешают вход.
- Golden hash независимо проверен Node crypto и настоящим закреплённым workerd. Локальный PBKDF2-600000 действительно работает; это не доказывает Worker Free CPU или поведение удалённого runtime.
- Env policy продублирована только в пределах нового независимого модуля, сохранён parity-test с закрытым legacy env guard. Legacy файлы не менялись.
- Модуль не подключён в `worker.ts`/handler/package. Текущий preview по-прежнему использует тестовую Supabase Auth схему; production auth не переключалась.

Независимые проверки Codex:

| Проверка | Результат |
|---|---|
| focused verifier unit + real workerd | 2 файла, 31 passed, exit 0 |
| `npm run check` | lint/typecheck/colors чисто; 162 файла passed + 1 skipped; 1277 тестов passed + 4 skipped, exit 0 |
| colors | 298 файлов |
| `npm run build`, AYPROM_STATIC_BUILD=1 | exit 0, 36/36 |
| локальная упаковка с закреплённым Wrangler dry-run | exit 0; Worker 48884 байта raw / 12172 gzip |

Ошибки отсутствующего `@xmldom/xmldom` из worktree Claude не воспроизвелись в integration с установленными зависимостями. Они не объявляются успешным прогоном Claude: положительное доказательство — отдельный общий прогон Codex. Известный jsdom diagnostic неподдерживаемой навигации повторился, но тесты не упали; он не заменяет браузерное доказательство навигации.

Build использовал публичный ключ существующего loopback стенда 54321 и временные process env; общий сервис не перезапускался. Browser origin `static-build.invalid` диагностический, не release bindings.

Новый ignored пакет: `dist/worker-packages/legacy-verifier-review-20260930`. Взяты прежние публичные страницы `dist/staging/20260929T181759Z-46d45efe`: новый полный public crawl не выполнялся. 182 assets, 9741963 байта. `ready: false`, `previewReady: true`, `productionReady: false`; неподключённый verifier не попадает в этот runtime bundle. Cursor inventory пока в него НЕ добавлялся.

Packaged isolated Supabase/workerd/Chromium smoke: **17/17**, exit 0, cleanup true. Проверены публичные страницы/поиск, cookie/origin, защищённый список/поиск/пагинация, отзыв по версии, login/logout без JavaScript и отказ при outage. Собственный project ID `ayprom-admin-auth-f4996b8500`; общий стенд не останавливался. Это проверка прежнего тестового Supabase Auth пути в новом пакете, НЕ подключённого legacy verifier. Предупреждение Node MODULE_TYPELESS_PACKAGE_JSON осталось; package.json ради него не менялся.

## Cursor: возвращён на точечную доработку

Проверена чистая `codex/cursor-package-integrity`, HEAD `9c438ad442b0ae937ba1cc963d266bd66e11240f`. Код и тесты прочитаны. Этот коммит НЕ перенесён в integration.

Два содержательных отказа воспроизведены безопасной диагностикой без изменения пакета/исходников: Node `syncBuiltinESMExports` подставлял fs-результаты только в одном процессе.

1. Для существующего manifest lstat.size был подставлен как 25 МиБ + 1; readFileSync возвращал корректный JSON с inventory реального пакета. Verifier вернул `{ok:true}`, чтение произошло. Manifest исключён из собственных хешей корректно, но исключение его из byte limits некорректно. Preview-runtime также читает metadata до verifier.
2. Чтение worker.js выбрасывало Error с фиктивной чувствительной строкой. `collectPackageInventory` выбросил исходное исключение без безопасного code; исходный текст сохранился. CLI не имеет собственной exception boundary. Реальные secrets не использовались.

Также по коду виден неограниченный обход пустых каталогов: count/byte limits относятся только к файлам. Требуется отдельный предел directories/depth; это замечание статического review, а не воспроизведённый filesystem crash.

Задание `docs/superpowers/agent-tasks/2026-09-30-cursor-integrity-boundaries.md`: RED→GREEN для metadata limits, safe I/O refusal и bounded directory traversal. Модель Grok 4.7 High. Сам файл задания не означает, что владелец уже запустил агента.

## Следующая параллельная работа и gates

- Claude / Sonnet 5 High: `docs/superpowers/agent-tasks/2026-09-30-claude-credential-reader.md`. Только неподключённый GET-reader credential row на существующем bounded JSON transport. Успешное `[]` — пустая таблица; отсутствие таблицы/ошибка сети — отказ, не env fallback. Общую БД не трогать.
- Codex интегрирует reader и verifier отдельным слайсом после review. Перед подключением нужен тест смены credential version между проверкой пароля и выпуском cookie: раздельные boolean/version ports сами по себе не связывают эти действия. Пока это выявленный integration gate, не заявленная эксплуатируемая production-ошибка.
- CPU hash-пути остаётся недоказанным внешним gate. Смена пароля через Vercel сама по себе его не решает: запись PBKDF2-хеша в общую таблицу всё равно потребует проверки этого хеша Worker'ом. Алгоритм/итерации нельзя молча ослаблять.
- CRUD/media/import/revision/rollback, release bindings, remote staging/quota/DNS ещё не закрыты. Эта приёмка не завершает миграцию.

Использованы навыки Cloudflare Workers/Wrangler для проверки реального runtime и актуальных API, Supabase — для разделения публичного build key и приватных auth-портов. [Cloudflare CPU limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time) описывают Free 10 ms; wall-clock время локального теста не выдаётся за это измерение.

## Основной checkout — проверенный факт

Перед финальным локальным checkpoint: `git diff --check` прошёл, Graphify update — exit 0, 3950 nodes / 8052 edges. Предупреждение о пяти JSON/config файлах без AST nodes не скрывается; это ограничение графа, не провал тестов. Остаточных workerd-процессов и контейнеров собственного smoke-проекта не обнаружено; 11 общих контейнеров `site-for-kirsan` сохранены.

HEAD `de708af735fb0620a71d35b19c3fcf578c948c6d`, без изменений в рамках этой работы:

```text
## main...origin/main [ahead 30, behind 1]
?? .codex/
?? debug.log
?? docs/CLOUDFLARE_FREE_HOSTING_MIGRATION_PLAN.md
```
