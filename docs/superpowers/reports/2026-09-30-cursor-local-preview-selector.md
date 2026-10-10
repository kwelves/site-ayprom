# Локальный выбор проверенного admin-preview

Дата: 2026-09-30. Ветка: `codex/cursor-local-preview-selector`.
Основа: `0e778bd0bb76ebb340a3533856fba4cf4558daa4`.
Прежняя ветка `codex/cursor-package-integrity` осталась на `0ad07f266183833ad28cd7ddeccfca8d818e2ac2`.
Это не deploy, не перенос в `dist/site` и не запуск Worker.

## Что делает

Выбор хранится только в `dist/local-preview/selection.json`: номер поколения, текущий пакет и предыдущий. Пакеты лежат в `dist/worker-packages` и этим инструментом не изменяются и не удаляются.

```powershell
node scripts/cloudflare/local-preview-selector.mjs status
node scripts/cloudflare/local-preview-selector.mjs select --package <имя> --generation <номер>
node scripts/cloudflare/local-preview-selector.mjs rollback --generation <номер>
```

`status` только читает. `select` и `rollback` перед записью вызывают уже существующую проверку preview: нужен `previewReady: true`, `productionReady: false` и целый inventory. Чужой путь, junction и symlink отклоняются. Запись идёт во временный файл в той же папке и затем заменяет выбор. Чужая блокировка не удаляется. Если замена не закончилась, старый выбор остаётся. Испорченное или слишком большое состояние не подменяется догадкой.

Смена требует ожидаемый номер поколения. Если выбора ещё нет, допустим только 0.

## RED и GREEN

- RED: `npx vitest run tests/cloudflare-local-preview-selector.test.ts --maxWorkers=2` — exit 1, модуля ещё не было.
- GREEN: тот же запуск — 9 из 9, exit 0.
- `npm run check`: exit 0. Внутри lint, typecheck, цвета и `npm test` (maxWorkers=2 уже в скрипте). 1366 тестов прошли, 4 пропущены.

## Исправление трёх ошибок выбора

Повторный выбор того же пакета больше не меняет номер поколения и не записывает текущий пакет в предыдущий. Если номер поколения уже максимальный безопасный, смена и откат отказываются до записи. Замена файла выбора — только одно переименование. Если оно не удалось, старый файл остаётся на месте; запасной перенос и восстановление убраны.

- RED: четыре новые проверки упали (повторный выбор, переполнение, EPERM и EACCES). Чужая блокировка уже не снималась.
- GREEN: `npx vitest run tests/cloudflare-local-preview-selector.test.ts --maxWorkers=2` — 13 из 13.
- `npm run check`: exit 0. 1370 тестов прошли, 4 пропущены.

Окно, когда файла выбора нет, потому что его сначала убрали в запасную копию, закрыто. Остаётся гонка: пакет могут подменить ссылкой после проверки и до записи. Это не закрыто. Выбор по-прежнему не подпись и не запуск Worker.
