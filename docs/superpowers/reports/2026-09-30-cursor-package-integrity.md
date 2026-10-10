# Целостность локального пакета Worker

Дата: 2026-09-30. Ветка: `codex/cursor-package-integrity`.
Основа: `1c53c4546723bba2d8c96ea2aa8594667706cb95`.
Прежняя ветка `codex/cursor-worker-package` не переписывалась и осталась на `8367321879a83d0d6e8a06cb20bbc6e79acfa8fc`.
Только локальная работа. Push, deploy, DNS и production не трогались.

## Что это

После успешной записи `worker.js`, `wrangler.jsonc` и файлов `site/**` оба упаковщика дописывают в `package-manifest.json` список SHA-256. Сам manifest в этот список не входит. Отдельная команда только читает пакет и сверяет, не изменились ли файлы.

Это защита от случайной порчи. Это не подпись и не защита от того, кто подменит и файлы, и список одновременно. `ready: false` и `productionReady: false` у admin-preview сохранены.

Проверка отказывается от junction и symlink в родителях и внутри пакета, не читая цель ссылки. Также отказ: путь наружу, столкновение регистра, имена устройств Windows, лишний или пропавший файл, другой размер или хеш. За один раз не читается больше 20 000 файлов и 20 000 каталогов, глубина не больше 32, файл больше 25 МиБ и суммарно больше 512 МиБ. Manifest и конфиг тоже не читаются, если они больше 25 МиБ: этого хватает на список из 20 000 обычных путей, но не на безразмерный файл. Сам список по-прежнему не входит в собственный SHA-256. Слишком длинный список отсекается по числу записей до разбора каждой строки. Сбой чтения даёт только код `package_integrity_failed` и правило `read_failed`, без текста ошибки и пути.

## Доработка границ чтения

- RED: 6 новых проверок упали, потому что слишком большой manifest ещё читался, а сбой чтения отдавал исходный текст.
- GREEN: `npx vitest run tests/cloudflare-package-integrity.test.ts tests/cloudflare-admin-preview-runtime.test.ts --maxWorkers=2` — 19 из 19.
- Упаковщики: `npx vitest run tests/cloudflare-worker-package.test.ts --maxWorkers=2` — 19 из 19.
- `npm run lint`, `npm run typecheck`, `npm run check:colors`: exit 0.
- `npm test`: exit 0, 1239 прошли, 4 пропущены.
- Это не закрывает гонку, когда каталог подменяют уже после проверки. Подписи нет, и пакет не становится production-ready.

Старый preview без списка отклоняется кодом `missing_inventory`. Его не дописывают задним числом: нужно заново собрать в новый каталог `dist/worker-packages/<новое-имя>`.

```powershell
node scripts/cloudflare/verify-package-integrity.mjs --package dist/worker-packages/<имя>
```

`--deploy` не поддерживается и ничего не запускает. Сеть не используется. В ответ только `ok`, `code` и `rule`.

## RED и GREEN

- RED: `npx vitest run tests/cloudflare-package-integrity.test.ts --maxWorkers=2` — exit 1, модуля ещё не было.
- GREEN тех же проверок и runtime: exit 0, 13 из 13.
- Упаковщики с настоящим локальным Wrangler `deploy --dry-run`: `npx vitest run tests/cloudflare-worker-package.test.ts --maxWorkers=2` — exit 0, 19 из 19. Wrangler 4.135.0 уже был в локальной папке `.wrangler`.
- `npm run lint`, `npm run typecheck`, `npm run check:colors`: exit 0. Цвета проверены в 296 файлах.
- `npm test` (в скрипте уже есть `--maxWorkers=2`): exit 0, 1233 прошли, 4 пропущены. Повтор того же флага второй раз останавливает Vitest, поэтому полный прогон запущен как `npm test`.

## Ограничения

- Локальная сверка не доказывает production, удалённый staging, auth или квоту Cloudflare.
- Список можно подменить вместе с файлами; отдельной подписи нет.
- Гонка, когда каталог подменяют ссылкой уже после проверки, не закрыта.
- Supabase не запускался.
