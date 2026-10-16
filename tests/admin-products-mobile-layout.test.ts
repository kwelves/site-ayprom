import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const productsList = readFileSync(
  fileURLToPath(new URL("../src/components/admin/ProductsList.tsx", import.meta.url)),
  "utf8",
);
const sortableList = readFileSync(
  fileURLToPath(new URL("../src/components/admin/SortableList.tsx", import.meta.url)),
  "utf8",
);
const undoToast = readFileSync(
  fileURLToPath(new URL("../src/components/admin/ui/AdminUndoToast.tsx", import.meta.url)),
  "utf8",
);

describe("мобильная строка товара в админке", () => {
  it("выносит управление товаром на всю ширину под компактной шапкой", () => {
    // Шапка строки: чекбокс, фото, название с подписью, меню; управление ниже на всю ширину (до md).
    expect(productsList).toContain("grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center");
    expect(productsList).toContain("col-span-4 grid grid-cols-2");
    expect(productsList).toContain("min-w-0 md:flex-1");
    expect(productsList).toContain("break-words text-sm");
    expect(productsList).toContain("[overflow-wrap:anywhere]");
    expect(productsList).toContain("className=\"col-span-2 row-start-2 w-full");
  });

  it("сохраняет удобные touch-зоны и адаптируется к узким экранам", () => {
    expect(productsList).toContain("min-[420px]:flex min-[420px]:flex-wrap");
    expect(productsList).toContain("inline-flex min-h-11 items-center");
    expect(productsList).toContain("containerClassName=\"min-h-11");
    expect(productsList).toContain("className: \"min-h-11 md:ml-auto md:min-h-0\"");
    expect(sortableList).toContain("min-h-11 min-w-8");
    expect(productsList).toContain("ProductActionsButton");
  });

  it("не переносит существующие действия в новое меню", () => {
    expect(productsList).toContain('href={`/admin/products/${product.slug}/edit`}');
    expect(productsList).toContain("handleTogglePublished(product, !product.published)");
    expect(productsList).toContain("handleAvailabilityChange(product, next)");
    expect(productsList).toContain("deleteConfirm.request(product)");
  });

  it("собирает стрелки и drag-handle в одну мобильную рейку", () => {
    expect(sortableList).toContain('className="flex shrink-0 flex-col items-center md:contents"');
    expect(sortableList).toContain('aria-label="Перетащить для изменения порядка"');
    expect(sortableList).toContain('aria-label="Переместить выше"');
    expect(sortableList).toContain('aria-label="Переместить ниже"');
  });

  it("сохраняет 44px touch-зоны действий Undo-toast на мобильном", () => {
    expect(undoToast).toContain("min-h-11 shrink-0");
    expect(undoToast).toContain("md:min-h-0");
    expect(undoToast).toContain("inline-flex h-11 w-11");
    expect(undoToast).toContain("md:h-auto md:w-auto");
  });
});
