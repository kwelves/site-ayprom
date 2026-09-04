/**
 * Единая дизайн-система карточек и карточных сеток.
 *
 * До неё каждая сетка задавала зазор по месту (от 12 до 32px), инсет вокруг
 * картинки был свой у каждой карточки (p-3/p-4/p-5), а ширины в `calc()`
 * вручную подгонялись под конкретный `gap` — стоило поменять зазор, и вёрстка
 * разъезжалась. Здесь один источник правды.
 *
 * Классы ширины записаны литералами, а не собираются из `CARD_GRID_GAP`:
 * Tailwind сканирует исходники на готовые строки и класс, склеенный в
 * рантайме, просто не попадёт в CSS. Чтобы литералы не разошлись с числами,
 * их соответствие проверяет `tests/card-system.test.ts`.
 */

/** Зазор сетки в пикселях по брейкпоинтам — числовой источник правды. */
export const CARD_GRID_GAP = { base: 16, sm: 20, lg: 24 } as const;

/** Зазор для любой сетки карточек. Другого зазора в системе нет. */
export const CARD_GRID_GAP_CLASSNAME = "gap-4 sm:gap-5 lg:gap-6";

/**
 * Инсет вокруг фотографии или логотипа. Живёт на фото-зоне, а НЕ на `<img>`:
 * padding на самой картинке делает её контентную коробку шире объявленной
 * пропорции, и `object-contain` добирает разницу неравномерными полями по
 * бокам — зазор перестаёт быть одинаковым с четырёх сторон, а текст под
 * фотографией не попадает с ней на одну вертикаль.
 */
export const CARD_MEDIA_INSET_CLASSNAME = "p-4";

/** Рамка карточки: одна на товары, категории, бренды и контакты. */
export const CARD_FRAME_CLASSNAME = "rounded-xl border border-card-edge bg-card";

/** Подпись под медиа у карточек-«обложек» (категория, бренд). */
export const CARD_CAPTION_CLASSNAME = "px-4 py-3.5 text-center";

/** Заголовок в подписи. Один размер во всех сетках. */
export const CARD_TITLE_CLASSNAME = "text-sm font-medium sm:text-base";

/** Ширина одной карточки при `columns` колонках и зазоре `CARD_GRID_GAP.lg`. */
const LG_WIDTH_CLASSNAME = {
  2: "lg:w-[calc(50%-0.75rem)]",
  3: "lg:w-[calc(33.3333%-1rem)]",
  4: "lg:w-[calc(25%-1.125rem)]",
} as const;

/** Ниже lg сетка всегда 2-up, поэтому ширины ровно две — базовая и sm. */
const BASE_WIDTH_CLASSNAME = "w-[calc(50%-0.5rem)]";
const SM_WIDTH_CLASSNAME = "sm:w-[calc(50%-0.625rem)]";

export interface CardGridSizing {
  /** Ширина обёртки карточки: 2-up до lg, `min(itemCount, 4)`-up с lg. */
  itemClassName: string;
  /** Ширина самого ряда — узкая при двух карточках, чтобы они не растягивались. */
  containerClassName: string;
}

/**
 * Сетка карточек любой природы: товары, подкатегории, бренды, категории.
 *
 * Ниже lg всегда 2 колонки независимо от количества — телефон и планшет
 * получают одинаково плотную раскладку. «Настоящее» число колонок
 * (`min(itemCount, 4)`) включается только с lg. Хвост, не заполнивший ряд,
 * центрируется: это flex-wrap + justify-center у вызывающей стороны, потому
 * что CSS grid неполный последний ряд не центрирует.
 */
export function getCardGridSizing(itemCount: number): CardGridSizing {
  const columns = Math.min(Math.max(itemCount, 2), 4) as 2 | 3 | 4;

  return {
    itemClassName: `${BASE_WIDTH_CLASSNAME} shrink-0 ${SM_WIDTH_CLASSNAME} ${LG_WIDTH_CLASSNAME[columns]}`,
    containerClassName: columns <= 2 ? "mx-auto max-w-3xl" : "mx-auto max-w-3xl lg:max-w-none",
  };
}
