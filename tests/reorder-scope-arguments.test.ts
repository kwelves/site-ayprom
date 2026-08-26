import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// QA-003: порядок подкатегорий и фотографий не был ограничен родителем. Действие
// принимало `categorySlug`/`productSlug` для revalidatePath, но в RPC его не
// передавало, поэтому идентификаторы чужой категории или чужого товара
// перенумеровывались без возражений.
//
// Сам контракт живёт в БД и проверяется pgTAP (reorder_contracts.test.sql).
// Здесь фиксируется прикладная половина: действие обязано передать родителя в
// RPC. Проверка идёт по исходнику — той же идиомой, что и
// admin-delete-storage-order.test.ts, поэтому не требует мока Supabase.
// Переводы строк нормализуются: Git на Windows выдаёт файл с CRLF, и поиск по
// "\n}\n" тогда не находит ничего — тест «падал» бы на полностью исправном коде.
const source = readFileSync(path.join(process.cwd(), "src/lib/admin/actions.ts"), "utf8").replace(
  /\r\n/g,
  "\n",
);

// Срез заканчивается на закрывающей скобке самой функции, а не на следующем
// `export`: иначе в тело попадают комментарии соседних действий.
function actionBody(name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  expect(start, `действие ${name} не найдено`).toBeGreaterThan(-1);
  const end = source.indexOf("\n}\n", start);
  expect(end, `не найден конец действия ${name}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("reorder actions pass the parent scope to the RPC", () => {
  it.each([
    ["reorderProductImages", "reorder_product_images", "target_product_slug: productSlug"],
    ["reorderSubcategories", "reorder_subcategories", "target_category_slug: categorySlug"],
    ["reorderCategoryBrands", "reorder_category_brands", "target_category_slug: categorySlug"],
  ])("%s передаёт родителя в %s", (action, rpcName, scopeArgument) => {
    const body = actionBody(action);

    expect(body).toContain(`.rpc("${rpcName}"`);
    expect(body).toContain(scopeArgument);
  });

  // Глобальные списки родителя не имеют: у них порядок сквозной по каталогу.
  it.each([
    ["reorderProducts", "reorder_products"],
    ["reorderBrands", "reorder_brands"],
    ["reorderCategories", "reorder_categories"],
    ["reorderVehicleTypes", "reorder_vehicle_types"],
  ])("%s остаётся глобальным и не выдумывает scope", (action, rpcName) => {
    const body = actionBody(action);

    expect(body).toContain(`.rpc("${rpcName}"`);
    expect(body).not.toContain("target_");
  });
});
