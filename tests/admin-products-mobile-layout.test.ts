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
    expect(productsList).toContain("grid-cols-[2.75rem_3rem_minmax(0,1fr)]");
    expect(productsList).toContain("contents md:block md:min-w-0 md:flex-1");
    expect(productsList).toContain("grid-cols-[minmax(0,1fr)_2.75rem]");
    expect(productsList).toContain("col-span-2 mt-1 text-xs");
    expect(productsList).toContain("break-words text-sm");
    expect(productsList).toContain("[overflow-wrap:anywhere]");
    expect(productsList).toContain("col-span-3 grid grid-cols-2");
  });

  it("сохраняет удобные touch-зоны и адаптируется к узким экранам", () => {
    expect(productsList).toContain("min-[380px]:grid-cols-[auto_minmax(0,1fr)_auto]");
    expect(productsList).toContain("[&>button]:min-h-11");
    expect(productsList).toContain("containerClassName=\"min-h-11");
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
