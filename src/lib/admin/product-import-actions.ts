"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminSession } from "@/lib/admin/actions";
import { revalidatePath } from "next/cache";
import {
  parseProductImportCsv,
  type ImportCatalogReference,
  type ImportPreview,
} from "@/lib/admin/product-import-parse";

// Batch по 500: PostgREST/config.toml ограничивает ответ max_rows = 1000, а
// сам import_products_batch выполняет по несколько DML-операторов на строку
// — держим запрос заведомо ниже потолка и в разумных по времени пределах.
const IMPORT_BATCH_SIZE = 500;
const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

async function parseUploadedImport(formData: FormData): Promise<ImportPreview> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Выберите CSV-файл для импорта.");
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new Error("CSV-файл слишком большой. Максимальный размер — 5 МБ.");
  }

  const csvText = await file.text();
  const reference = await loadCatalogReference();
  return parseProductImportCsv(csvText, reference);
}

async function loadCatalogReference(): Promise<ImportCatalogReference> {
  const supabase = createAdminClient();
  const [{ data: categories }, { data: subcategories }, { data: brands }, { data: vehicleTypes }, { data: products }] =
    await Promise.all([
      supabase.from("categories").select("slug"),
      supabase.from("subcategories").select("id, slug, category_slug"),
      supabase.from("brands").select("slug"),
      supabase.from("vehicle_types").select("slug"),
      supabase.from("products").select("slug, article"),
    ]);

  const subcategoriesByCategory = new Map<string, Map<string, string>>();
  for (const row of subcategories ?? []) {
    if (!subcategoriesByCategory.has(row.category_slug)) {
      subcategoriesByCategory.set(row.category_slug, new Map());
    }
    subcategoriesByCategory.get(row.category_slug)!.set(row.slug, row.id);
  }

  const articleToSlug = new Map<string, string>();
  const existingSlugs = new Set<string>();
  for (const row of products ?? []) {
    existingSlugs.add(row.slug);
    if (row.article) articleToSlug.set(row.article, row.slug);
  }

  return {
    categorySlugs: new Set((categories ?? []).map((c) => c.slug)),
    subcategoriesByCategory,
    brandSlugs: new Set((brands ?? []).map((b) => b.slug)),
    vehicleTypeSlugs: new Set((vehicleTypes ?? []).map((v) => v.slug)),
    existingSlugs,
    articleToSlug,
  };
}

// Файл разбирается на сервере (сразу за requireAdminSession), а не в браузере:
// справочники для валидации читаются через service-role клиент, и text() —
// единственное, что нужно от File на этом шаге.
export async function previewProductImport(formData: FormData): Promise<ImportPreview> {
  await requireAdminSession();
  return parseUploadedImport(formData);
}

export interface ImportCommitResult {
  created: number;
  updated: number;
  errors: { rowIndex: number; slug: string; message: string }[];
}

// Server Actions are public mutation endpoints: the browser may call this
// function directly and forge every ordinary argument. Re-read and revalidate
// the original file here instead of trusting rows returned to the preview UI.
export async function commitProductImport(formData: FormData): Promise<ImportCommitResult> {
  await requireAdminSession();
  const { validRows: rows } = await parseUploadedImport(formData);
  const supabase = createAdminClient();
  const result: ImportCommitResult = { created: 0, updated: 0, errors: [] };

  for (let offset = 0; offset < rows.length; offset += IMPORT_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + IMPORT_BATCH_SIZE);
    const { data, error } = await supabase.rpc("import_products_batch", {
      rows: batch.map((row) => ({
        row_index: row.rowIndex,
        article: row.article,
        name: row.name,
        slug: row.slug,
        category_slug: row.categorySlug,
        subcategory_id: row.subcategoryId,
        short_description: row.shortDescription,
        description: row.description,
        published: row.published,
        brand_slugs: row.brandSlugs,
        vehicle_type_slugs: row.vehicleTypeSlugs,
        characteristics: row.characteristics,
      })),
    });
    if (error) throw error;

    for (const outcome of data as { row_index: number; slug: string; action: string; error_message: string | null }[]) {
      if (outcome.action === "created") result.created += 1;
      else if (outcome.action === "updated") result.updated += 1;
      else result.errors.push({ rowIndex: outcome.row_index, slug: outcome.slug, message: outcome.error_message ?? "Неизвестная ошибка." });
    }
  }

  revalidatePath("/admin/products");
  revalidatePath("/", "layout");
  return result;
}
