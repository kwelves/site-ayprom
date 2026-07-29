# План реализации

Каждая фаза = один git-чекпоинт (lint + typecheck + build перед коммитом), без деплоя.

## Phase 0 — Инфраструктура
- Подключить Geist Mono через `next/font` рядом с существующим Geist Sans.
- Добавить производные CSS-токены: `--hairline` (blue-600 @8-10%), `--grid-line`/скобки (blue-500 @30-40%).
- Создать server-примитивы `HairlineDivider`, `CornerBracket` (aria-hidden, pointer-events-none) — без применения, только компоненты.

## Phase 1 — IA-каркас (наибольшая бизнес-ценность по матрице, 92 vs 55-68 на удобство каталога)
- `Breadcrumbs` (server, mobile-сворачивание в «Назад к [уровень]»).
- `CatalogContextBar` (server) — breadcrumbs + «Найдено: N» (aria-live="polite", Geist Mono для числа).
- `FilterRail` (server, desktop, 260px) / `FilterSheet` (client-leaf, mobile bottom-sheet, переиспользует существующую height-анимацию мобильного меню) — ссылки-чипы по Категория/Подкатегория/Бренд/Тип техники через query-параметры к существующему backend RPC. Без чекбокс-мультиселекта, без клиентского состояния каталога.
- `HeaderSearchTrigger` (client-leaf, тонкая обёртка) поверх существующего поиска — тот же `action="/catalog" GET`, что и в Hero.
- Блок «Похожие товары» на карточке товара (тот же подкатегория/бренд-запрос, существующие query-функции).

## Phase 2 — VehicleShowcase

**Верификация (сделана 2026-07-28, реальный скролл через agent-browser, не full-page screenshot):** секция полностью видна и работает — заголовок + 8 карточек техники рендерятся корректно поверх фона. Подтверждает: baseline-диагноз "невидимый контент" был артефактом full-page скриншота, не багом.

**Важная коррекция:** council-план предполагал отдельный "второй imagery-блок (кран/стройка)", который нужно заменить на `VehicleCompatibilityStrip`. Верификация показала, что такого отдельного блока не существует — то, что baseline-аудит принял за него, и есть сам `VehicleShowcaseSection` (его собственный фон из `VehicleShowcaseBackground`). Заменять нечего — `VehicleCompatibilityStrip` из плана исключён.

Фактический объём Phase 2:
- `VehicleTypeChip` (server) — постоянный кликабельный лейбл на каждой карточке («Экскаваторы» → `/catalog/vehicle-type/[slug]`), видим и на mobile. Ценен сам по себе (навигация/SEO), не как фикс несуществующего бага.
- Geometry `VehicleShowcaseCard` не трогается.
- **Убрать ambient-видео из `VehicleShowcaseBackground.tsx`** (решено пользователем): удалить `<video>`-элемент и источник `public/videos/vehicle-showcase-background.mp4`, оставить статичный `posterSrc` (`/images/vehicle-showcase-poster.webp`) как единственный фон + существующие затемняющие overlay. Убрать связанный IntersectionObserver play/pause код (больше не нужен без видео). Hero-видео остаётся единственным видео на странице.

## Phase 3 — Footer и Hero-полировка

**Верификация (2026-07-29, реальный скролл через agent-browser):** тот же артефакт, что с VehicleShowcase — контент Footer (`Reveal` с `whileInView`) не попал в full-page baseline-скриншот, только строка копирайта снаружи обёртки. На деле Footer уже полноценный: лого, описание, реальная навигация (`buildMainNav`), контакты (адрес/email/соцсети/телефон), копирайт. Диагноз "почти пустой footer" был ложным. `FooterTitleBlock` из плана исключён — редизайн не нужен.

Фактический объём Phase 3:
- 4 угловые CAD-скобки по периметру Hero-видео (используют уже готовый `CornerBracket` из Phase 0, статичный CSS).
- Ряд из 4-6 quick-access чипов под Hero CTA (топ-категории/типы техники).

## Phase 4 — опционально, только с явного разрешения пользователя
- Leader-line hover-sync на `VehicleCompatibilityStrip` (после визуального QA на реальных скриншотах).

## После каждой фазы
`npm run lint` / `npm run typecheck` / `npm run build` → фикс ошибок → git-коммит с коротким сообщением → (если разрешён agent-browser) визуальная проверка desktop+mobile на реальном скролле, не только screenshot.
