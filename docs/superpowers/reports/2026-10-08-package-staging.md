# Plan B Task 2: настоящий пакет и сохраняемая загрузка, 2026-10-08

Исходная точка проверена: codex/cloudflare-integration, HEAD 72a32308f9a7ced68cee2c2df33d9e432606d7e9, чистый status.
Ожидаемый e596861 находится в истории; его девять провалов уже исправлены.
Повтор baseline: journal/upload/journaled-stage/inspector — 39/39.

ECC: tdd-workflow, security-review, verification-loop, по docs/ECC_WORKFLOW.md.
Источник: утверждённый Plan B, Task 2, и следующая точка в отчёте
2026-10-08-publication-write-ahead-journal.md.

## Соединение inspector с Node staging

RED 2d02806: новый suite не импортировался из-за отсутствующего stage-publication-package.
Отдельный npm run typecheck воспроизвёл TS2307 (нет реализации) и TS2322:
настоящий inspector мог вернуть отказ без release metadata, старый InspectedPackage
требовал success metadata даже для отказа. Это compile-time RED, не девять
выполненных runtime failures.

GREEN: npx --no-install vitest run tests/cloudflare-package-staging.test.ts
tests/cloudflare-publication-upload.test.ts tests/cloudflare-journaled-stage.test.ts
--maxWorkers=2 — 24/24, exit 0; npm run typecheck — exit 0.

stagePublicationPackage использует настоящий inspector без возможности заменить его
из входного объекта. Внешне ожидаемые id/revision/release digest/package digest
сверяются с файлами. Журнал создаётся в Node и защищает async операцию от
конкурентного запуска и повтора по сохранённой истории.

| Гарантия | Проверка |
|---|---|
| Настоящий отказ inspector не требует фиктивных полей | missing package, никаких port calls |
| До preview записаны намерение и version ID | настоящий файловый journal, три статуса |
| Испорченные bytes, чужой digest/release/revision не грузятся | четыре отрицательных сценария |
| Потерянный ответ не вызывает новую загрузку | повтор с заново открытым journal |
| Чужой lock сохраняется | port не вызывается |
| CLI явно локальный и отвергает remote flags | Node subprocess, journal persistence/replay |

CLI stage-publication-package.mjs поддерживает только --local-contract.
Это реальная проверка файлов/journal с фикстурным version port; probe повторяет
проверку файлов. Он НЕ выполняет HTTP smoke удалённого preview и явно возвращает
fixtureOnly:true, remoteVerified:false, productionReady:false.
CLI не читает env credentials и не выбирает remote port. Ошибки фиксированные,
без путей, URL, token/capability или внутренних исключений.

## Общие ворота этого блока

- npm run check: exit 0; 218 файлов passed / 1 skipped;
  1952 теста passed / 4 skipped. Прогон запущен до добавления отдельного
  RED-suite Wrangler adapter; его будущая реализация этим PASS не доказана.
- node scripts/cloudflare/local-catalog-publication-contract.mjs --pinned-build:
  exit 0; 82 SQL assertions, 28 HTTP checks, 14 capture checks, 2 races;
  настоящий Next build/crawl/package, workerd и Chromium. pinnedBuild.ok:true,
  productionReady:false, advisors results:[]; собственный стек остановлен.
- Graphify обновлён; git diff --check exit 0, только LF/CRLF предупреждение.

Процент покрытия не измерен: coverage-v8 не установлен. Четыре существующих
пропуска не объявляются прошедшими. Файлы пакетов и старые снимки сохраняются.
Ограничение подмены файлов после проверки (TOCTOU) остаётся.
Push/deploy/production и изменения основной папки/чужих worktrees не выполнялись.

## Следующая работа

Конкретный staging-only Wrangler inactive adapter, затем coordinator/SQL ports,
компенсация и откат, неизменяемые медиа и admin mutations в порядке Plan B.
Удалённые staging/Free CPU/DNS/cutover остаются отдельно разрешаемыми воротами.
