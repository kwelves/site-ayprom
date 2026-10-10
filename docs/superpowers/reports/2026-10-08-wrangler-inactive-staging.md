# Plan B Task 2: staging-only Wrangler transport, 2026-10-08

Источник: утверждённый Plan B, Task 2. Использованы ECC tdd-workflow,
security-review, verification-loop. Работа только в codex/cloudflare-integration
в C:\Users\user\.codex\worktrees\ayprom-integration\site-for-kirsan.
Исходный фактический HEAD 72a3230; старый e596861 уже содержал исправленное
в последующих коммитах RED журнала.

## Что реализовано

Предыдущий блок ad28307 подключил настоящий inspector к файловому журналу
и локальному CLI (см. 2026-10-08-package-staging.md).
Новый createWranglerInactivePort — конкретный Node transport, который
при явно разрешённом будущем вызове может выполнить только versions upload
или deployments list. activate/rollback всегда отказывают.
Локальный CLI этот port не выбирает и remote mode не имеет.

Команды сверены с --help установленного Wrangler 4.135.0:
versions upload, versions view, deployments list. Формат version-upload
в WRANGLER_OUTPUT_FILE_PATH и JSON deployments list проверен по установленному
wrangler-dist/cli.js. Текстовый консольный лог не разбирается как успех.
Официальные сведения:
[Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/),
[Version URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/).

На временном конфиге заданы только фиксированный staging Worker
ayprom-publication-staging, public Supabase URL/key,
release ID и ASSETS. Capability хранится в собственном временном secrets-file,
API token передаётся child env, не argv. Исходный пакет не переписывается.
Окружение не наследует ключи приложения, NODE_OPTIONS или API overrides;
dotenv и telemetry выключены для child. Вывод наружу не содержит stdout/stderr
Wrangler, URL, capability, token или внутренних исключений.

Пакет заново проверяется перед командой. Повтор команды после возможного
remote effect запрещён в одном экземпляре port; повторы между процессами
блокируются настоящим release journal через stagePublicationPackage.
Обработка currentDeployment выбирает последнюю дату, требует одну версию
со 100 процентами трафика; пустая история, одинаковое время, split traffic,
неверные IDs и даты отвергаются.

## TDD evidence

- RED 8cabab5: suite не импортировался, отсутствовал wrangler-inactive-port.
  Это missing-implementation RED, не выполненные runtime assertions.
- Первичный GREEN: adapter + package staging — 21/21, exit 0.
- Расширенные проверки: 6 publication suites — 68/68.
- Дополнительный runtime RED: impossible-date ответ 2026-02-30:
  1 failed / 20 passed; port неверно принимал дату.
  RED checkpoint ab830fc; итоговый GREEN по шести suites — 69/69, exit 0;
  чекпоинты записаны в Git history; squash не выполнялся.
- Первый typecheck adapter выявил несовместимость изолированного child env
  с глобальным ProcessEnv приложения. Исправлено по существующему шаблону
  producer/child-server.ts, без добавления Supabase secret в child.
  Этот непрошедший check не считается PASS.
- Один общий прогон застал дополнительно внесённый RED даты и также не считается PASS.

| Гарантия | Доказательство |
|---|---|
| Upload не deploy и не activate | Проверка exact command list; запрет activate/rollback |
| Limited config и отсутствие capability в config/argv | Реальные файлы в temporary cwd внутри fake runner |
| Digest сверяется до remote effect | Изменённые bytes и другой packageDir, runner не вызван |
| Structured response bound к ожидаемому worker/version URL | Wrong worker/URL, duplicate/malformed/oversize output |
| Неизвестный ответ не повторяется автоматически | Timeout exception, одна попытка; real journal replay |
| Split traffic и невозможные даты не считаются одним live выпуском | Fault scenarios currentDeployment |
| Node child transport работает | Локальный stub .cjs, default runner, без Cloudflare |
| Intent durable до command | Реальный inspector + journal + concrete command builder |

## Настоящий локальный пакет

Полный pinned gate в этом ходе: 82 SQL assertions, 28 HTTP checks,
14 capture checks (2 races), Next build/crawl/package, workerd и Chromium,
exit 0; pinnedBuild.ok:true; advisors results:[]; собственный стек остановлен.
Публичный Worker/Next source новым adapter не изменялся.

Пакет: dist/worker-packages/pinned-local-2d8b984d428dc0da.
Inspector: ok:true, release 6da67162-cfcf-420f-9330-5cb23c22652d, revision 7.
Package digest cd4fc35c787183299e7d86593411a9f28b15b0c7e4436f93ac053c7a5480b87a.
Worker 104705 raw / 23895 gzip bytes, 182 assets.

Новая local-contract CLI на этом реальном пакете: первый вызов exit 0,
inactive_verified, fixtureOnly:true, remoteVerified:false, productionReady:false.
Второй вызов exit 1, rejected; сохранённый journal не переписан.
Журнал: dist/release-journals/local-contract-9fd7bce87baf47ee84b9fa0d141ea0f2.jsonl.
Это фикстурный Cloudflare port, не настоящая удалённая версия.

## Ограничения и следующий этап

- Ни один настоящий remote command adapter не выполнялся.
  Разрешения token/account, staging DB isolation, наследуемые remote secrets,
  preview setting, quotas/Free CPU и фактический Cloudflare output ещё не проверены.
  kind:staging и фиксированное имя сами не доказывают отсутствие production данных.
- --secrets-file применяется аддитивно. До разрешённого remote теста нужно
  проверить прежние bindings staging Worker и отсутствие наследуемых
  production secrets; этот adapter не очищает чужие secrets.
- Capability должен относиться к данному снимку; совпадение/ограничение права
  проверяет будущий настоящий preview probe. Ограниченный config не заменяет
  remote permission audit.
- Preview известных version IDs хранится в памяти этого экземпляра.
  Восстановление после перезапуска требует отдельного coordinator/reconciliation,
  а не повторной загрузки. Malformed/missing upload result остаётся unresolved.
- mode 0600 и удаление temporary directory применены; отдельный аудит Windows ACL
  и защита от процесса с доступом к диску не выполнялись.
- Сохраняется TOCTOU после проверки файлов. Digest не является подписью.
- Процент покрытия не измерен, coverage-v8 не установлен. Зависимости не менялись.

Следующая локальная задача Plan B Task 3: coordinator с проверками ревизии,
журналом намерения до activation, сверкой deployment ID при потерянном ответе,
компенсацией и возвратом pointer, live probe и queue confirm только после успеха.
В zz_catalog_publications.sql состояния ready и active pointer уже есть,
но отдельных приватных RPC mark-ready/CAS ещё нет; нужен TDD SQL/migration,
явные GRANT/REVOKE и реальные pgTAP/PostgREST проверки на собственном стенде.
Stage-only port не заменяет activation/rollback transport.
Затем неизменяемое R2 media (Task 4), admin mutations (Task 5).
Push/deploy/production, main и чужие worktrees не тронуты.

## Итоговая проверка

Последний npm run check после исправления даты: exit 0; 219 файлов passed /
1 skipped, 1973 теста passed / 4 skipped. Lint, typecheck, colors прошли.
Непрошедшие предыдущие прогоны сохранены выше и не считаются PASS.
Целевые 6 suites: 69/69, exit 0 (включая 21 adapter test).
Graphify после final code: exit 0; git diff --check: exit 0, LF/CRLF предупреждения.
Runtime Worker и Next source новым Node transport не менялись; настоящий
pinned-build/workerd/browser gate этого хода остаётся применим к этим файлам.

До настоящего remote gate ещё нужно независимо связать загруженную версию с
ожидаемыми release/package hashes и проверить её runtime-ответы:
успешный локальный command builder и случайный version ID не заменяют эту проверку.
GREEN checkpoint включает только реализацию загрузчика и отчёт/handoff.
Следующий HEAD читать через git rev-parse HEAD; ветка codex/cloudflare-integration.
Рабочая папка после commit должна быть проверена отдельным git status.
