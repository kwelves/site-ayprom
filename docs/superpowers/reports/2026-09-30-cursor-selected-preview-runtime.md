# Чтение выбранного локального admin-preview

Дата: 2026-09-30. Ветка: `codex/cursor-selected-preview-runtime`.
Основа: `4b6c14a59d64d56e688d45c0cdea66e132bf4e55`.
Прежняя ветка `codex/cursor-local-preview-selector` осталась на `06bef2243ff05159170f3bfdcf2006ea9b787538`.

Это только чтение. Worker не запускается, `selection.json` не меняется, пакеты и `dist/site` не трогаются.

## Что делает

`resolveSelectedAdminPreview({ repoRoot, expectedGeneration })` читает текущий выбор, сверяет номер поколения и снова проверяет пакет уже существующей проверкой preview. Затем читает выбор ещё раз. Если за это время сменили пакет или номер, возвращает отказ `selection_changed`. Иначе отдаёт готовую локальную конфигурацию для будущего запуска.

Ошибки — только фиксированные коды. Текста исключения, содержимого файлов и секретов в ответе нет.

## RED и GREEN

- RED: `npx vitest run tests/cloudflare-selected-preview-runtime.test.ts --maxWorkers=2` — exit 1, helper ещё не было.
- GREEN: тот же запуск — 7 из 7, exit 0.
- `npm run check`: exit 0. Внутри lint, typecheck, цвета и тесты. 1470 тестов прошли, 4 пропущены.

## Что не закрыто

После последней сверки выбора пакет или каталог всё ещё могут подменить. Это окно не закрыто. Результат не подпись и не разрешение на production. Helper не подключён к запуску Worker.
