/**
 * Общая геометрия витрины техники.
 *
 * Статическая заглушка (`VehicleShowcaseShell`) рендерится на сервере, а
 * интерактивная версия приезжает отдельным чанком уже после того, как секция
 * приблизилась к экрану. Чтобы подмена не двигала ни одного пикселя, обе
 * версии обязаны брать размеры из одного места — отсюда. Модуль намеренно без
 * зависимостей: его импортируют и серверная заглушка, и клиентский код.
 */

/** Внешняя рамка витрины: и у заглушки, и у интерактива она одна и та же. */
export const SHOWCASE_ROOT_CLASS = "relative lg:flex lg:flex-1 lg:flex-col";

/** Подпись с названием техники над сценой. */
export const SHOWCASE_LABEL_CLASS = "text-xs font-semibold tracking-wide text-slate-400 uppercase";

/** Сетка «сцена + карточка». Размеры фиксированы с первого рендера. */
export const SHOWCASE_GRID_CLASS =
  "relative mx-auto mt-3 grid grid-cols-1 gap-6 lg:mx-0 lg:flex-1 lg:grid-cols-[1.3fr_1fr] lg:gap-10 lg:p-1";

// One fixed shape for every vehicle so switching vehicles never resizes the
// section — only the vehicle drawing (via object-contain) scales to fit
// inside it, and the whole thing is always fully visible, never cropped.
// Taller/near-square on narrow screens (there's no second column stealing
// width there, and the native photos are themselves portrait-ish) so the
// vehicle doesn't shrink to a speck; wide on desktop where the stage shares
// the row with the card.
export const STAGE_ASPECT_CLASS = "aspect-[4/3] sm:aspect-[3/2] lg:aspect-auto lg:h-full";

/** Сцена целиком (обёртка фотографии и хотспотов). */
export const SHOWCASE_STAGE_CLASS = `relative w-full lg:overflow-hidden ${STAGE_ASPECT_CLASS}`;

/** Зарезервированная высота карточки товара / подсказки. */
export const SHOWCASE_CARD_CLASS = "min-h-[220px] lg:mt-4 lg:min-h-[29rem]";

/** Внутренний блок подсказки, пока хотспот не выбран. */
export const SHOWCASE_HINT_CLASS = "flex min-h-[220px] flex-col justify-center gap-2 px-2 lg:min-h-0";

/** Строка карусели под сеткой. */
export const SHOWCASE_CAROUSEL_ROW_CLASS = "mt-8 shrink-0 origin-top lg:mt-4";

/** Ограничитель ширины карусели. */
export const SHOWCASE_CAROUSEL_FRAME_CLASS = "relative mx-auto w-full max-w-4xl";

/** Высота ленты миниатюр — она и задаёт высоту всей строки карусели. */
export const SHOWCASE_CAROUSEL_MASK_CLASS = "relative z-10 h-20 overflow-hidden sm:h-24 lg:h-28";
