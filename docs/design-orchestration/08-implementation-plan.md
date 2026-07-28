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
- **Сначала верификация, не редизайн**: реальным скроллом (не full-page screenshot) проверить, действительно ли грид карточек скрыт визуально из-за Reveal/Stagger — если да, отдельная задача на анимационный баг; если нет (что вероятнее), пропустить этот пункт.
- `VehicleTypeChip` (server) — постоянный кликабельный лейбл на каждой карточке («Экскаваторы · 340» → `/catalog/vehicle-type/[slug]`), видим и на mobile.
- `VehicleCompatibilityStrip` (server) заменяет второй imagery-блок — реальные ссылки на типы техники, без hover-leader-line в v1.
- Geometry `VehicleShowcaseCard` не трогается.
- **Убрать ambient-видео из `VehicleShowcaseBackground.tsx`** (решено пользователем): удалить `<video>`-элемент и источник `public/videos/vehicle-showcase-background.mp4`, оставить статичный `posterSrc` (`/images/vehicle-showcase-poster.webp`) как единственный фон + существующие затемняющие overlay. Убрать связанный IntersectionObserver play/pause код (больше не нужен без видео). Hero-видео остаётся единственным видео на странице.

## Phase 3 — Footer и Hero-полировка
- `FooterTitleBlock` — реальная навигация (категории/бренды/контакты) вместо строки копирайта.
- 4 угловые CAD-скобки по периметру Hero-видео (статичный CSS).
- Ряд из 4-6 quick-access чипов под Hero CTA (топ-категории/типы техники).

## Phase 4 — опционально, только с явного разрешения пользователя
- Leader-line hover-sync на `VehicleCompatibilityStrip` (после визуального QA на реальных скриншотах).

## После каждой фазы
`npm run lint` / `npm run typecheck` / `npm run build` → фикс ошибок → git-коммит с коротким сообщением → (если разрешён agent-browser) визуальная проверка desktop+mobile на реальном скролле, не только screenshot.
