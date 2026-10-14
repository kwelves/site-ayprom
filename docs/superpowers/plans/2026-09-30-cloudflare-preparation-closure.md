# Завершение локальной подготовки миграции

Исходная точка: `1c53c4546723bba2d8c96ea2aa8594667706cb95`, `codex/cloudflare-integration`.
Разрешение владельца: продолжать и заканчивать подготовку локально, распределяя независимые задачи между Codex, Claude и Cursor. Это не разрешение на deploy, DNS, production mutations или удаление Vercel.

## Что считается окончанием подготовки

Не только успешные unit tests: совместимый вход администратора, нужные admin-операции и media-путь; воспроизводимый пакет публичных страниц с проверенной целостностью; ошибки сборки не повреждают предыдущую локальную публикацию; реальный локальный Worker/browser smoke; явный список внешних gates. Нельзя заменять отсутствующие gates флагом готовности или fixture.

## Текущая волна (независимые участки)

- [x] Codex: ограничить все backend-вызовы локальной Worker-авторизации по времени/размеру, запретить redirects и URL userinfo; доказать отказ до выдачи cookie, не меняя legacy Next auth или public API. Проверки: 1246 тестов, build 36/36, dry-run и packaged isolated smoke 17/17. Отчёт `docs/superpowers/reports/2026-09-30-cloudflare-admin-http-boundaries.md`.
- [x] Cursor: package SHA-256 inventory + read-only verification перед preview runtime. `9c438ad` и исправление границ `0ad07f2` приняты как `6879796`/`7746b0e`. Manifest/config ограничены до чтения, I/O ошибки санитизированы, обход ограничен по числу каталогов/глубине. Старые пакеты без inventory отклоняются, новый пакет собран отдельно; это проверка случайной порчи, не подпись.
- [x] Claude: injected, неподключённый legacy-password verifier + golden compatibility test на workerd. `2c7bd48` принят как `c1e56c8`; независимые 31/31 теста и общий check 1277 passed / 4 skipped, build 36/36. Worker/preview verifier НЕ переключались. Следующее независимое задание: `docs/superpowers/agent-tasks/2026-09-30-claude-credential-reader.md`.
- [x] Claude: неподключённый read-only credential reader `6e80d5d` принят как `47d6371`. Codex добавил RED→GREEN защиту от не-ASCII ключей до создания Headers. Реальный GET на существующем loopback Supabase подтвердил пустую строку учётных данных; production не читался и не менялся.
- [x] Codex: review текущей волны отдельно от main; 104 focused tests, общий check 1357 passed / 4 skipped, build 36/36, пакет через локальный Wrangler и isolated packaged smoke 17/17. Следующее обязательное auth-доказательство — связь проверенного пароля с его версией; reader/verifier пока не подключены. Отчёт `docs/superpowers/reports/2026-09-30-cloudflare-integrity-reader-integration.md`.
- [x] Claude: password/version proof `44a9574` принят как `8f53e85`, с дополнительным исправлением Codex: credential state копируется до crypto await. Два независимых RED теста воспроизвели неверную версию при изменении общего объекта, GREEN и реальный workerd подтвердили отказ. Общий check: 1408 passed / 4 skipped, build 36/36, свежий пакет и isolated browser smoke 17/17. Worker wiring пока прежний.
- [x] Cursor: local preview selector `593bbb7` и исправление `06bef22` приняты как `88aa1ce`/`eb45a15`. Codex повторил независимый harness: A→A — валидный no-op, overflow отклонён без записи, отказ единственного rename сохраняет прежние байты selection.json. Выбор не запускает Worker и не является production rollback. Остаточная TOCTOU-гонка не закрыта.
- [x] Claude: reusable reserve/finish + legacy-admin composition `1610b20` приняты как `5a1533d`. Сохранены HTTP boundaries и старый Supabase Auth adapter; новая фабрика использует credential row/env, без email/user id/GoTrue. Совместные focused tests: 75/75, включая настоящий workerd. Фабрика НЕ подключена к worker.ts/preview/smoke.

## Последующие обязательные локальные участки

- [x] Совместимый verifier подключён к локальному Worker: credential row/PBKDF2, либо ADMIN_PASSWORD только при пустой строке; без GoTrue/email/user id. Реальный новый пакет + собственный isolated Supabase + Chromium no-JS: 19/19, включая env/hash вход, отказ env после появления hash, отзыв старой сессии, hash без env, outage, публичный поиск и защищённый read-only список. Production пароль и Next adapter не менялись. Remote CPU и полная production parity остаются gates. Отчёт `docs/superpowers/reports/2026-09-30-cloudflare-legacy-auth-wiring.md`.
- [x] Claude: внутренний неподключённый CAS writer для `admin_credentials` принят как `7b8aaaa`. Codex проверил его на собственной локальной Supabase через настоящий workerd/PostgREST: insert 1→2, конфликт повторного insert, PATCH 2→3, stale conflict и ровно один победитель из двух параллельных PATCH. Сбой часов теперь даёт фиксированную ошибку до fetch. Это не API смены пароля и не завершение ADM-04.
- [x] Cursor: локальные тесты границ `/admin` Static Assets приняты как `8464fe4`. Гость не получает HTML скрытой оболочки через прямые файловые пути, регистр, кодировку или другие методы. Проверка на fixture и локальном workerd, не на удалённом Cloudflare.
- [ ] Product mutations отдельными слайсами: validate → auth/origin → CAS/atomic RPC → audit; сначала одна операция, затем create/edit/delete/publish/bulk. Проверки только на собственной тестовой БД.
- [ ] Справочники, import и showcase contracts из ADM-06/07/08, без молчаливой потери существующих возможностей.
- [ ] Node/Sharp processor и R2 upload/process/cleanup, test fixtures/local storage; production buckets не использовать для тестовых записей. Для недоступного локального эквивалента явно оставить gate внешнего test bucket.
- [ ] Mutation → revision/build snapshot, сохранение предыдущего локального артефакта при ошибке, rollback без потери данных; fault injection. Не перезаписывать dist/site, пока эти guards не приняты.
- [ ] Свежий public snapshot/build с production-совместимыми browser bindings без секретов; настоящие mobile/desktop navigation, поиск/пагинация, accessibility, media fallback и SEO проверки. Диагностический static-build.invalid не является release config.
- [ ] Обновить registry фактами текущей архитектуры: исторический vinext spike не равен статусу thin Worker.

## Внешние gates — только после отдельного разрешения

Изолированный remote staging, фактический Worker Free CPU и quota, remote bindings/secrets, test R2, routing/billing semantics, репетиция rollback и DNS cutover. Локальный workerd измерил медианное wall time 338–506 мс для проверки PBKDF2-600000 и 455–591 мс для создания hash в двух прогонах при лимите Free 10 мс CPU; wall time не равно CPU и локальный лимит не применяется. Это высокий риск для admin auth, а не доказанный удалённый отказ. До измерения реального `cpuTime`/`exceededCpu` не объявлять auth совместимым с Free и не ослаблять PBKDF2. Отчёт `docs/superpowers/reports/2026-09-30-cloudflare-worker-free-auth-cpu-risk.md`. До закрытия gates `productionReady` остаётся false; Vercel сохраняется действующим origin.

## Проверки и checkpoint каждой волны

TDD RED→GREEN, relevant focused tests, npm run check, npm run build, local Worker dry-run, real workerd smoke, git diff --check, graphify update ., локальный commit только своих файлов. При параллельных прогонах Vitest maxWorkers=2; общую БД и Docker не перезапускать. Claude/Cursor передают отчёты через владельца; наличие задания не значит, что агент уже запущен.
