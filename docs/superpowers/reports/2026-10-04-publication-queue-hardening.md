# Независимая проверка очереди публикации

Дата: 2026-10-04. Ветка `codex/claude-publication-queue-hardening` от `2e5af47`.
Проверены `20261004000000_publication_jobs.sql`, `supabase/schemas/zz_publication_jobs.sql`,
`publication-queue.ts`, их unit- и pgTAP-тесты. Реальная база — только собственный
временный проект Supabase на портах 566xx; он остановлен и удалён вместе с volume.

## Найденный дефект

Сгенерированная миграция потеряла `REVOKE ALL … FROM … service_role`, который
объявлен в декларативной схеме. Из-за default privileges схемы `public` у
`service_role` на `publication_jobs` оказались DELETE, TRUNCATE, REFERENCES и
TRIGGER (`arwdDxtm`), а не объявленные SELECT/INSERT/UPDATE. Builder-ключ мог
удалить singleton и тем самым обнулить `deployed_revision` и предел трёх попыток.

- RED: новый pgTAP `table_privs_are(... service_role, SELECT/INSERT/UPDATE)` на
  чистой базе — 1 из 39 падает с «Extra privileges: DELETE, REFERENCES, TRIGGER, TRUNCATE».
- Исправление: отдельная миграция `20261004000100_publication_jobs_least_privilege.sql`
  (исходная миграция не менялась), права совпадают со схемой.
- GREEN: 39/39; ACL `service_role=arw`; реальный клиент работает, DELETE ключом
  builder — 403.

## Проверено и дефектов не найдено (реальный Postgres/PostgREST)

- 20 параллельных claim: ровно один победитель и при первой вставке строки, и
  после истёкшего lease; 10 параллельных claim через клиент — один.
- Истёкший lease: старый token не подтверждает и не сбрасывает ни до, ни после
  нового claim; попытка засчитывается.
- Три попытки (включая истёкшие lease) → автоматический claim прекращается;
  ручной retry открывает его снова и выдаёт новый token; retry при активном
  lease и для уже опубликованной ревизии — false.
- Каталог изменён и закоммичен во время сборки → confirm false,
  `stale_revision`, lease снят, следующий claim берёт новую ревизию (attempt 1).
  Незакоммиченная правка во время confirm не мешает; после её коммита
  ревизия выше `deployed_revision`, и она будет собрана. Debounce соблюдается.
  Записи в очередь не повышают ревизию каталога.
- `anon`/`authenticated`: нет прав на таблицу и ни на одну RPC (через PostgREST —
  401). Клиент импортируется только тестом и smoke-скриптом; ключ — только в
  заголовках, ошибки обезличены.

## Остаточные риски проектирования (не исправлялись)

- Lease нельзя продлить. Если сборка дольше lease, второй builder начнёт
  параллельную сборку. Promotion внешняя: builder с истёкшим lease может
  опубликовать более старую ревизию поверх новой; его confirm вернёт false, но
  на хостинге уже будет старая версия. Нужны продление/проверка lease
  непосредственно перед promotion и CAS на стороне хостинга.
- Confirm устаревшей, но уже опубликованной ревизии не записывает её
  `deployment_identifier`; база занижает фактически опубликованную ревизию до
  следующей успешной публикации.
