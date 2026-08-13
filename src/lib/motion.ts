import type { Variants } from "framer-motion";

/*
 * Framer Motion не умеет читать CSS-переменные, поэтому токены движения из
 * `@theme` в src/app/globals.css продублированы здесь в тех единицах, которых
 * ждёт Framer (секунды, массив контрольных точек). Две копии одних значений
 * неизбежно разъезжаются, поэтому tests/motion-tokens.test.ts парсит
 * globals.css и сверяет их с тем, что объявлено ниже.
 *
 * Всё, что можно сделать классами Tailwind (`duration-base ease-ui`), делается
 * классами — эти константы нужны только там, где анимацией управляет Framer:
 * `AnimatePresence`, `whileInView`, анимация `height: auto`.
 */
export const DURATION = {
  fast: 0.15,
  base: 0.2,
  slow: 0.28,
  reveal: 0.42,
} as const;

export const EASE_UI = [0.23, 1, 0.32, 1] as const;
export const EASE_UI_IN_OUT = [0.77, 0, 0.175, 1] as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: DURATION.reveal, ease: EASE_UI } },
};

// Шаг каскада намеренно мелкий: на сетке каталога бывает два десятка карточек,
// и при 0.08 с последняя появлялась только через 1.6 с после первой.
export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04 } },
};
