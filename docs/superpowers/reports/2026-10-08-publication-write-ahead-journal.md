# Plan B Task 2: журнал до неактивной загрузки

## Цель

Не терять сведения о попытке загрузки новой версии и не превращать неизвестный
результат в успех. Источник задачи — утверждённый
`docs/superpowers/plans/2026-10-05-cloudflare-publication-release.md`, Task 2.
Использованы ECC tdd-workflow, security-review и verification-loop.

## TDD и гарантии

- RED checkpoint `e596861`: журнал, 9 failed / 4 passed. Дефекты воспроизведены
  на реальных временных файлах: повреждённая история, оборванная строка,
  повтор eventId, размер, количество, чужой lock и неверная календарная дата.
- GREEN checkpoint `1949ebb`: исправлен журнал. Журнал + локальный version port:
  16/16; typecheck exit 0. Запись проверяет историю под исключительным lock,
  запрещает дописывать повреждения/переполнение, подтверждается после fsync.
- RED checkpoint `b4a0bba`: неактивная загрузка, 7 failed / 3 passed.
- GREEN: upload + journal + local port — 26/26. Команда:
  `npx vitest run tests/cloudflare-publication-upload.test.ts tests/cloudflare-release-journal.test.ts tests/cloudflare-local-version-port.test.ts --maxWorkers=2`.

| Гарантия | Доказательство |
|---|---|
| До upload записывается намерение | Тест порядка current → journal → upload |
| Ошибка первой записи не начинает upload | upload не вызывается, rejected |
| Полученный versionId записывается до preview | Тест порядка и отказа второй записи |
| Потерянный ответ не становится успехом | Одна upload-попытка, current сверяется, unresolved записан |
| Плохой preview сохраняет старый live только после проверки | failed_old_live + preview_failed в журнале |
| Чужое переключение остаётся неизвестным | unresolved + concurrent_deployment, без activate/rollback |
| Отказ последней записи не даёт inactive_verified | Третий отказ journal, outcome unresolved |
| Хеш пакета и снимка, старые version/deployment ID сохраняются | Проверка точного объекта записи |

## Изменения

`release-journal.ts`: строгая история до append, максимум 8 МиБ и 10 000
записей, уникальные eventId, завершающий newline, настоящая ISO-дата, bounded
чтение descriptor, исключительный `.lock` и fsync файла до подтверждения.
Чужой lock не снимается. Dangling symlink больше не принимается за отсутствующий
родитель. Новая запись обязана содержать releaseSha256 и previousVersionId:
старые журналы без этих полей закрыто отклоняются, автоматически не переписываются.

`cloudflare-version-port.ts`: upload_started → inactive_uploaded →
inactive_verified; сохранение отказов. Новый путь никогда не активирует и не
откатывает Cloudflare. Все ответы productionReady:false, исключения не отражаются
наружу. Журнал не хранит preview URL, ключи, capability или текст ошибок.

## Ограничения

- Это локальный контракт и журнал, не конкретный удалённый Cloudflare adapter.
- Вызовы на фикстурном port не доказывают реальную неактивную загрузку Cloudflare.
- fsync файла не доказывает сохранность нового directory entry при потере питания
  на любом диске/ОС. Ошибка записи может оставить полный или оборванный event;
  результат нельзя повторять вслепую.
- После аварии orphan lock автоматически не снимается; потребуется проверка
  владельца/процесса и состояния операции, не таймер и не принудительное удаление.
- Злонамеренная подмена пути после проверки (TOCTOU) не закрыта. Блокировка
  защищает согласованные процессы, не произвольный процесс с доступом к диску.
- Низкоуровневый stageInactiveCandidate сам не проверяет историю повторов.
  Для будущего CLI добавлена stageJournaledCandidate: она держит отдельный
  operation lock через весь async preview, читает историю и не повторяет
  неизвестную/проверенную попытку. Восстановление существующей version ID
  принадлежит будущему coordinator, не новой загрузке.
- Процент покрытия не измерен: @vitest/coverage-v8 в проекте не установлен.
  Зависимости ради этой проверки не добавлялись; тестовые гарантии перечислены выше.

## Дополнение: настоящий inspector и защита повторов

- `publication-package-inspector.mjs` + read-only CLI
  `node scripts/cloudflare/inspect-publication-package.mjs --package <каталог>`.
  Повторно используют package-integrity; проверяют pinned release/revision,
  файл source-revision, три допустимых верхнеуровневых файла, сведения о Worker
  и assets, точный локальный config. Preview/productionReady:true/секретоподобные
  дополнительные поля отклоняются. Digest включает байты manifest с SHA-256
  проверенных файлов, а не только inventory без собственного manifest.
- RED `4f19932`: inspector отсутствовал, suite не импортировалась. GREEN 11/11,
  checkpoint `0d0b7c8`. Это функциональный GREEN; последующая общая проверка
  выявила ошибки сужения union-типа в новых тестах, они исправлены отдельно.
- RED `c1cb6ff`: journaled staging отсутствовал. GREEN: 5/5; вместе с upload,
  journal и inspector — 39/39. Файл заново открывается после потерянного ответа:
  новой upload-попытки нет. Параллельные async попытки не проходят один lock.
  Чужой lock и повреждённая история не меняются, порт не вызывается.
- `npm run check` первого блока: exit 0, 215 файлов passed/1 skipped,
  1927 тестов passed/4 skipped. Новый inspector этим прогоном не покрывался.
  Следующий полный прогон остановился на typecheck новых тестов inspector;
  не считался PASS. После исправления запущен полный повтор.
- Проверка действительности inspector не является подписью или разрешением
  загрузки. Между проверкой и использованием файлы могут быть подменены;
  ограничение TOCTOU сохранено. Подтверждения gzip/Free CPU/удалённой платформы
  этот inspector не даёт.

## Итоговая проверка текущего кода

- Последний `npm run check`: exit 0, **217 файлов passed / 1 skipped;
  1943 теста passed / 4 skipped**. Включает 5 новых journaled-stage тестов.
  Предыдущий успешный прогон (1938) начался до их добавления и не считается
  доказательством этих пяти проверок. Style/typecheck/colors пройдены.
- `node scripts/cloudflare/local-catalog-publication-contract.mjs --pinned-build`:
  exit 0; 82 pgTAP assertions, 28 реальных HTTP-проверок, 14 capture checks
  (включая 2 гонки и настоящие CLI/exports), настоящий Next build/crawl/package,
  локальный workerd и Chromium browser smoke. `pinnedBuild.ok:true`,
  `productionReady:false`; security advisors — results:[]; собственный стенд
  остановлен. Это не проверка удалённого Cloudflare.
- Inspector CLI на пакете этого реального прогона
  `dist/worker-packages/pinned-local-e0aa9b5611a7d7f0`: exit 0, ready:true,
  productionReady:false. Выпуск `ee93f12b-213d-4aea-99e5-72b4300b46ae`, revision 7.
  Digest пакета `ff9000d38c7785fd08471fa0c23ea862590a463d6a615c27bf0765c50abd056e`.
- Worker: **104705 bytes raw / 23894 bytes gzip**, 182 assets. Это результат
  местной сборки, не измерение загруженного production Worker.
- `git diff --check`: exit 0, только предупреждения LF/CRLF.
- Пакеты/снимки не удалялись; основной main и untracked владельца не тронуты.

Push/deploy/production-изменений нет. Проверка файлов реального пакета и
фикстурная проверка staging с настоящим журналом являются отдельными воротами:
они не доказывают реальную Cloudflare version preview или удалённую загрузку.

## Следующая точка работы

Продолжать Plan B, не начинать заново RED журнала:

1. Подключить строгий inspector к Node orchestration (его union отказа нужно
   согласовать с InspectedPackage; сейчас stage принимает обязательные поля
   metadata даже для ok:false). Не заполнять фиктивной metadata успешный ответ.
2. Конкретный неактивный Cloudflare adapter/CLI после чтения help установленного
   Wrangler; никаких реальных remote-вызовов в локальных/unit gates.
3. Release coordinator + реальные приватные порты SQL ready/active-pointer CAS,
   recheck/activation/reconciliation/compensation/live probe/queue confirm.
4. Неизменяемое R2 media publication и затем admin mutations согласно Tasks 4–5.
5. После локальной приёмки — отдельные remote staging/CPU/DNS/cutover gates.

Миграция не завершена; для следующей локальной реализации нового выбора
владельца не требуется. Нельзя считать отсутствующий coordinator готовым
потому, что package inspector или файл журнала проходит тесты.
