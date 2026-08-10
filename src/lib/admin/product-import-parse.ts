// Чистая логика разбора и валидации импорта — без "server-only": её нужно
// вызывать и из Server Action (queries.ts тянет service-role клиент), и из
// тестов. Тот же приём, что уже применён для usage-descriptions.ts и
// pagination.ts.
import { csvToRecords } from "@/lib/admin/csv";
import { slugify } from "@/lib/admin/slugify";

export interface ImportCatalogReference {
  categorySlugs: Set<string>;
  subcategoriesByCategory: Map<string, Map<string, string>>; // category_slug -> (subcategory_slug -> id)
  brandSlugs: Set<string>;
  vehicleTypeSlugs: Set<string>;
  existingSlugs: Set<string>;
  articleToSlug: Map<string, string>; // непустой article -> slug существующего товара
}

export interface ParsedImportRow {
  rowIndex: number;
  article: string | null;
  name: string;
  slug: string;
  categorySlug: string;
  subcategoryId: string | null;
  shortDescription: string;
  description: string | null;
  published: boolean;
  brandSlugs: string[];
  vehicleTypeSlugs: string[];
  characteristics: { attribute: string; value: string }[];
  matchedExisting: boolean;
}

export interface ImportRowError {
  rowIndex: number;
  message: string;
}

export interface ImportPreview {
  validRows: ParsedImportRow[];
  errors: ImportRowError[];
  totalRows: number;
}

// Список слагов через ";" — терпим лишние пробелы и пустые элементы
// (последняя точка с запятой в файле, двойной разделитель).
function splitSlugList(value: string): string[] {
  return value
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

// "Атрибут=Значение;Атрибут2=Значение2" — значение может само содержать "=",
// поэтому режем по первому вхождению, а не split("=").
function parseCharacteristics(value: string): { attribute: string; value: string }[] {
  return splitSlugList(value)
    .map((pair) => {
      const separatorIndex = pair.indexOf("=");
      if (separatorIndex === -1) return null;
      const attribute = pair.slice(0, separatorIndex).trim();
      const characteristicValue = pair.slice(separatorIndex + 1).trim();
      if (!attribute || !characteristicValue) return null;
      return { attribute, value: characteristicValue };
    })
    .filter((c): c is { attribute: string; value: string } => c !== null);
}

function parsePublished(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  // Пусто — считаем опубликованным по умолчанию, как и создание вручную.
  if (!normalized) return true;
  return !["false", "0", "нет", "no", "черновик", "draft"].includes(normalized);
}

const REQUIRED_COLUMNS = ["name", "category", "short_description"] as const;

export function parseProductImportCsv(
  csvText: string,
  reference: ImportCatalogReference
): ImportPreview {
  const { header, rows } = csvToRecords(csvText);
  const errors: ImportRowError[] = [];

  const missingColumns = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missingColumns.length > 0) {
    return {
      validRows: [],
      errors: [
        {
          rowIndex: -1,
          message: `В файле отсутствуют обязательные колонки: ${missingColumns.join(", ")}. Ожидаются: name, article, category, subcategory, short_description, description, published, brands, vehicle_types, characteristics.`,
        },
      ],
      totalRows: rows.length,
    };
  }

  const validRows: ParsedImportRow[] = [];
  // Слаги, уже занятые предыдущими строками этого же файла — новый товар не
  // должен столкнуться с соседом по файлу, которого ещё нет в БД.
  const slugsUsedInFile = new Set<string>();
  // Тот же файл не должен создать два товара с одинаковым артикулом —
  // без этой проверки оба матчились бы в один и тот же существующий slug.
  const articlesUsedInFile = new Set<string>();

  rows.forEach((row, index) => {
    const rowIndex = index;
    const name = row.name?.trim();
    const categoryInput = row.category?.trim();
    const shortDescription = row.short_description?.trim();

    if (!name || !categoryInput || !shortDescription) {
      errors.push({
        rowIndex,
        message: "Заполните обязательные поля: name, category, short_description.",
      });
      return;
    }

    const categorySlug = categoryInput.toLowerCase();
    if (!reference.categorySlugs.has(categorySlug)) {
      errors.push({ rowIndex, message: `Неизвестная категория: «${categoryInput}».` });
      return;
    }

    const subcategoryInput = row.subcategory?.trim();
    let subcategoryId: string | null = null;
    if (subcategoryInput) {
      const subcategorySlug = subcategoryInput.toLowerCase();
      const subcategoryId_ = reference.subcategoriesByCategory.get(categorySlug)?.get(subcategorySlug);
      if (!subcategoryId_) {
        errors.push({
          rowIndex,
          message: `Подкатегория «${subcategoryInput}» не найдена в категории «${categoryInput}».`,
        });
        return;
      }
      subcategoryId = subcategoryId_;
    }

    const brandSlugs = splitSlugList(row.brands ?? "").map((s) => s.toLowerCase());
    const unknownBrand = brandSlugs.find((slug) => !reference.brandSlugs.has(slug));
    if (unknownBrand) {
      errors.push({ rowIndex, message: `Неизвестный бренд: «${unknownBrand}».` });
      return;
    }

    const vehicleTypeSlugs = splitSlugList(row.vehicle_types ?? "").map((s) => s.toLowerCase());
    const unknownVehicleType = vehicleTypeSlugs.find((slug) => !reference.vehicleTypeSlugs.has(slug));
    if (unknownVehicleType) {
      errors.push({ rowIndex, message: `Неизвестный тип техники: «${unknownVehicleType}».` });
      return;
    }

    const article = row.article?.trim() || null;
    if (article && articlesUsedInFile.has(article)) {
      errors.push({ rowIndex, message: `Артикул «${article}» повторяется в этом же файле.` });
      return;
    }

    // Сопоставление по артикулу: строка с известным article обновляет
    // существующий товар и наследует его текущий slug — переименование
    // товара через импорт не должно ломать его URL. Новый товар (или товар
    // без article) получает сгенерированный уникальный slug.
    const matchedSlug = article ? reference.articleToSlug.get(article) : undefined;
    let slug: string;
    let matchedExisting: boolean;

    if (matchedSlug) {
      slug = matchedSlug;
      matchedExisting = true;
    } else {
      const base = slugify(name) || "product";
      let candidate = base;
      let suffix = 2;
      while (reference.existingSlugs.has(candidate) || slugsUsedInFile.has(candidate)) {
        candidate = `${base}-${suffix}`;
        suffix += 1;
      }
      slug = candidate;
      matchedExisting = false;
    }

    slugsUsedInFile.add(slug);
    if (article) articlesUsedInFile.add(article);

    validRows.push({
      rowIndex,
      article,
      name,
      slug,
      categorySlug,
      subcategoryId,
      shortDescription,
      description: row.description?.trim() || null,
      published: parsePublished(row.published ?? ""),
      brandSlugs,
      vehicleTypeSlugs,
      characteristics: parseCharacteristics(row.characteristics ?? ""),
      matchedExisting,
    });
  });

  return { validRows, errors, totalRows: rows.length };
}
