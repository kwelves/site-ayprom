import { describe, expect, it } from "vitest";
import {
  CARD_GRID_GAP,
  CARD_GRID_GAP_CLASSNAME,
  getCardGridSizing,
  HOVER_BORDER_OVERHANG,
} from "@/lib/card-system";

/** `gap-4` = 16px, `gap-5` = 20px, `gap-6` = 24px — шкала Tailwind: N * 4px. */
function gapClassToPixels(token: string): number {
  const step = Number(token.replace(/^(sm:|lg:)?gap-/, ""));
  return step * 4;
}

/** Ширина колонки в вёрстке: 100/N% минус приходящаяся на карточку доля зазора. */
function expectedRem(columns: number, gap: number): number {
  return (gap * (columns - 1)) / columns / 16;
}

describe("дизайн-система карточных сеток", () => {
  it("класс зазора соответствует числовому источнику правды", () => {
    const [base, sm, lg] = CARD_GRID_GAP_CLASSNAME.split(" ");

    expect(gapClassToPixels(base)).toBe(CARD_GRID_GAP.base);
    expect(gapClassToPixels(sm)).toBe(CARD_GRID_GAP.sm);
    expect(gapClassToPixels(lg)).toBe(CARD_GRID_GAP.lg);
  });

  it.each([
    [2, 2],
    [3, 3],
    [4, 4],
    [9, 4],
  ])("при %i элементах считает ширину под фактический зазор", (itemCount, columns) => {
    const { itemClassName } = getCardGridSizing(itemCount);
    const insets = [...itemClassName.matchAll(/calc\((?:[\d.]+)%-([\d.]+)rem\)/g)].map((m) => Number(m[1]));

    // Ниже lg сетка всегда 2-up: базовый зазор, затем sm. Третья ширина — lg.
    expect(insets).toEqual([
      expectedRem(2, CARD_GRID_GAP.base),
      expectedRem(2, CARD_GRID_GAP.sm),
      expectedRem(columns, CARD_GRID_GAP.lg),
    ]);
  });

  it("одна карточка не растягивается на весь ряд", () => {
    expect(getCardGridSizing(1).itemClassName).toBe(getCardGridSizing(2).itemClassName);
    expect(getCardGridSizing(1).containerClassName).toContain("max-w-3xl");
  });
});

describe("halo hover-border", () => {
  it("не смыкается с подсветкой соседней карточки на самом плотном зазоре", () => {
    // Подсветки соседей выступают навстречу друг другу, поэтому съедают
    // удвоенный halo. Если этот запас уйдёт в ноль, на телефоне подсветки
    // сольются в одно пятно.
    const narrowest = Math.min(CARD_GRID_GAP.base, CARD_GRID_GAP.sm, CARD_GRID_GAP.lg);

    expect(HOVER_BORDER_OVERHANG * 2).toBeLessThan(narrowest);
  });
});
