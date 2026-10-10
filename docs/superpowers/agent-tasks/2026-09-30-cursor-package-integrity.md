# Задание Cursor: целостность локального пакета

Ты самостоятельный напарник в подготовке миграции AYPROM. Codex интегрирует результаты после review. Не объявляй локальные проверки доказательством готовности production.

## Рабочее место

Только `C:\Users\user\.codex\worktrees\ayprom-cursor-canonical\site-for-kirsan`.
Сейчас ожидается чистая ветка `codex/cursor-worker-package`, HEAD `8367321879a83d0d6e8a06cb20bbc6e79acfa8fc`. Проверь это. Сохрани прежнюю ветку, создай **новую** `codex/cursor-package-integrity` от существующего локального commit `1c53c4546723bba2d8c96ea2aa8594667706cb95`. Не делай reset, rebase или merge. При отличии фактов остановись и сообщи.

Прочитай AGENTS.md, PROJECT_BRIEF.md, docs/CLOUDFLARE_PARITY_REGISTRY.md, отчёты `2026-09-30-cloudflare-admin-preview-package.md` и `2026-09-30-cloudflare-admin-readonly-products.md`; обнови Graphify. Существующие node_modules могут отличаться от lockfile новой базы: проверяй, не меняй зависимости ради обхода ошибок. Production env не копируй.

## Задача

Через TDD добавь SHA-256 inventory для **готового локального пакета** и отдельную проверку, что пакет после сборки не изменился. Это защита от случайного изменения/повреждения, не цифровая подпись и не защита от злоумышленника, который заменяет manifest вместе с файлами.

Разрешённые файлы: новый `scripts/cloudflare/package-integrity.mjs`, новый read-only CLI `scripts/cloudflare/verify-package-integrity.mjs`, `scripts/cloudflare/package-worker-assets-lib.mjs`, `scripts/cloudflare/admin-preview-runtime.mjs`, связанные package/runtime тесты и новые integrity tests; отдельный отчёт `docs/superpowers/reports/2026-09-30-cursor-package-integrity.md`. Нужный diff в другие файлы предлагай в отчёте, не применяй. Codex параллельно правит только admin HTTP adapter, auth tests, smoke и свои docs; Claude пишет отдельный password verifier.

Требования:

1. Оба упаковщика (public и admin-preview) записывают inventory в manifest только после успешной записи worker/config/assets. SHA-256 каждого `worker.js`, `wrangler.jsonc` и обычного файла `site/**`; относительные portable пути, байтовая длина, детерминированный порядок. Сам manifest не хэшировать рекурсивно. Не ослаблять `ready: false`, `productionReady: false` у preview.
2. Проверка читает только явный пакет и сверяет missing/extra/changed files, hashes, lengths. Отказ на junction/symlink в корне/родителях/внутри, traversal, case collisions, Windows device names. Не читать цель ссылки. Не писать в пакет, staging или dist/site. Заранее ограничить число файлов и суммарный объём чтения; не загружать весь пакет одновременно в память.
3. Runtime-validator preview требует положительной integrity-проверки **до запуска** Worker. Старый пакет без inventory явно отклоняется; инструкция — пересобрать в новый output, не дописывать задним числом старому артефакту.
4. Ошибки/CLI выводят только фиксированные безопасные rule/code, не payload, URL query, секреты или содержимое изменённого файла. Параметр `--deploy` не поддерживается, сетевые действия отсутствуют.
5. Тесты RED→GREEN: untouched pass; изменение worker/config/HTML; added/missing file; empty site; unsafe inventory path; junction parent/child; forged preview release flags; отсутствие inventory; CLI exit 0/1 и read-only поведение. Старые package/runtime тесты обновляй по новому контракту, не удаляй проверки границ.
6. Запусти focused tests, lint, typecheck, check:colors, весь `npm test -- --maxWorkers=2`, `git diff --check`, Graphify и checkpoint только своих файлов. Реальный dry-run выполняй закреплённым локальным Wrangler, если он уже доступен; отсутствующий runtime честно обозначь. Supabase не нужен.

Не меняй production, DNS, R2, auth, SQL, Next UI, настройки общего Docker. Не запускай/останавливай общий Supabase. Никаких push, deploy, merge в main/integration. В отчёте: RED/GREEN, команды/exit, ограничения, commit и точный git status.

Рекомендуемая модель: **Grok 4.7 High**.
