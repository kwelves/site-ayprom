import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.join(process.cwd(), "src/lib/admin/actions.ts"), "utf8");

function actionBody(name: string, nextName: string): string {
  const start = source.indexOf(`export async function ${name}`);
  const end = source.indexOf(`export async function ${nextName}`, start);
  return source.slice(start, end);
}

describe("category storage cleanup order", () => {
  it.each([
    ["deleteCategory", "reorderCategories", '.from("categories").delete()', '"category"'],
    ["deleteSubcategory", "reorderSubcategories", '.from("subcategories").delete()', '"subcategory"'],
  ])("%s commits the database deletion before removing files", (name, nextName, deleteCall, cleanupContext) => {
    const body = actionBody(name, nextName);
    const databaseDelete = body.indexOf(deleteCall);
    const storageCleanup = body.indexOf(`removeFilesAfterDatabaseDelete(supabase, storagePaths, ${cleanupContext})`);

    expect(databaseDelete).toBeGreaterThan(-1);
    expect(storageCleanup).toBeGreaterThan(databaseDelete);
  });
});
