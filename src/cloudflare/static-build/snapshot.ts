import type { StaticBuildIssue, ValidationResult } from "./validation";

export interface SnapshotCategory {
  slug: string;
  name: string;
  type: "subcategory" | "brand" | null;
}

export interface SnapshotSubcategory {
  slug: string;
  name: string;
  categorySlug: string;
}

export interface SnapshotBrand {
  slug: string;
  name: string;
}

export interface SnapshotVehicleType {
  slug: string;
  name: string;
}

export interface SnapshotProduct {
  slug: string;
  name: string;
  category: string;
  subcategory?: string;
  compatibleBrands: string[];
  vehicleTypes: string[];
  images: { url: string; fallbackUrl?: string; scale?: number }[];
  shortDescription: string;
  article?: string;
  updatedAt: string;
}

export interface CatalogSnapshot {
  schemaVersion: 1;
  snapshotId: string;
  categories: SnapshotCategory[];
  subcategories: SnapshotSubcategory[];
  brands: SnapshotBrand[];
  vehicleTypes: SnapshotVehicleType[];
  categoryBrands: Record<string, string[]>;
  directProductCategorySlugs: string[];
  products: SnapshotProduct[];
}

export function validateCatalogSnapshot(
  input: unknown,
): ValidationResult<CatalogSnapshot> {
  const issues: StaticBuildIssue[] = [];
  if (!isRecord(input)) {
    return {
      ok: false,
      code: "snapshot_invalid",
      issues: [{ field: "snapshot", rule: "object_required" }],
    };
  }

  if (input.schemaVersion !== 1) {
    issues.push({ field: "schemaVersion", rule: "unsupported_schema" });
  }
  validateNonEmptyString(input.snapshotId, "snapshotId", issues);

  const categories = validateEntities(
    input.categories,
    "categories",
    issues,
    validateCategory,
  );
  const subcategories = validateEntities(
    input.subcategories,
    "subcategories",
    issues,
    validateSubcategory,
    (value) =>
      typeof value.categorySlug === "string" && typeof value.slug === "string"
        ? JSON.stringify([value.categorySlug, value.slug])
        : null,
  );
  const brands = validateEntities(input.brands, "brands", issues, validateNamedSlug);
  const vehicleTypes = validateEntities(
    input.vehicleTypes,
    "vehicleTypes",
    issues,
    validateNamedSlug,
  );
  const products = validateEntities(
    input.products,
    "products",
    issues,
    validateProduct,
  );

  const categorySlugs = slugSet(categories);
  const subcategoryParentsBySlug = new Map<string, Set<string>>();
  for (const value of subcategories) {
    if (!isRecord(value) || typeof value.slug !== "string" || typeof value.categorySlug !== "string") {
      continue;
    }
    const parents = subcategoryParentsBySlug.get(value.slug) ?? new Set<string>();
    parents.add(value.categorySlug);
    subcategoryParentsBySlug.set(value.slug, parents);
  }
  const brandSlugs = slugSet(brands);
  const vehicleTypeSlugs = slugSet(vehicleTypes);

  for (const [index, value] of subcategories.entries()) {
    if (!isRecord(value) || typeof value.categorySlug !== "string") continue;
    if (!categorySlugs.has(value.categorySlug)) {
      issues.push({
        field: `subcategories[${index}].categorySlug`,
        rule: "unknown_category",
      });
    }
  }

  for (const [index, value] of products.entries()) {
    if (!isRecord(value)) continue;
    const category = typeof value.category === "string" ? value.category : null;
    if (category && !categorySlugs.has(category)) {
      issues.push({ field: `products[${index}].category`, rule: "unknown_category" });
    }

    if (typeof value.subcategory === "string") {
      const parents = subcategoryParentsBySlug.get(value.subcategory);
      if (!parents) {
        issues.push({
          field: `products[${index}].subcategory`,
          rule: "unknown_subcategory",
        });
      } else if (category && !parents.has(category)) {
        issues.push({
          field: `products[${index}].subcategory`,
          rule: "subcategory_category_mismatch",
        });
      }
    }

    validateReferences(
      value.compatibleBrands,
      `products[${index}].compatibleBrands`,
      brandSlugs,
      "unknown_brand",
      issues,
    );
    validateReferences(
      value.vehicleTypes,
      `products[${index}].vehicleTypes`,
      vehicleTypeSlugs,
      "unknown_vehicle_type",
      issues,
    );
  }

  validateCategoryBrands(input.categoryBrands, categorySlugs, brandSlugs, issues);
  validateReferences(
    input.directProductCategorySlugs,
    "directProductCategorySlugs",
    categorySlugs,
    "unknown_category",
    issues,
  );

  if (issues.length > 0) {
    return { ok: false, code: "snapshot_invalid", issues };
  }
  return { ok: true, value: input as unknown as CatalogSnapshot };
}

function validateCategory(
  value: Record<string, unknown>,
  field: string,
  issues: StaticBuildIssue[],
) {
  validateSlug(value.slug, `${field}.slug`, issues);
  validateNonEmptyString(value.name, `${field}.name`, issues);
  if (value.type !== null && value.type !== "subcategory" && value.type !== "brand") {
    issues.push({ field: `${field}.type`, rule: "invalid_category_type" });
  }
}

function validateSubcategory(
  value: Record<string, unknown>,
  field: string,
  issues: StaticBuildIssue[],
) {
  validateNamedSlug(value, field, issues);
  validateSlug(value.categorySlug, `${field}.categorySlug`, issues);
}

function validateNamedSlug(
  value: Record<string, unknown>,
  field: string,
  issues: StaticBuildIssue[],
) {
  validateSlug(value.slug, `${field}.slug`, issues);
  validateNonEmptyString(value.name, `${field}.name`, issues);
}

function validateProduct(
  value: Record<string, unknown>,
  field: string,
  issues: StaticBuildIssue[],
) {
  validateSlug(value.slug, `${field}.slug`, issues);
  validateNonEmptyString(value.name, `${field}.name`, issues);
  validateSlug(value.category, `${field}.category`, issues);
  if (value.subcategory !== undefined) {
    validateSlug(value.subcategory, `${field}.subcategory`, issues);
  }
  validateStringArray(value.compatibleBrands, `${field}.compatibleBrands`, issues);
  validateStringArray(value.vehicleTypes, `${field}.vehicleTypes`, issues);
  validateImages(value.images, `${field}.images`, issues);
  // The database column is NOT NULL but may be empty (most real products); only the type is required.
  if (typeof value.shortDescription !== "string") {
    issues.push({ field: `${field}.shortDescription`, rule: "string_required" });
  }
  if (value.article !== undefined && typeof value.article !== "string") {
    issues.push({ field: `${field}.article`, rule: "string_required" });
  }
  if (!isIsoTimestamp(value.updatedAt)) {
    issues.push({ field: `${field}.updatedAt`, rule: "invalid_timestamp" });
  }
}

function validateEntities(
  value: unknown,
  field: string,
  issues: StaticBuildIssue[],
  validate: (
    item: Record<string, unknown>,
    itemField: string,
    itemIssues: StaticBuildIssue[],
  ) => void,
  identityForDuplicate?: (item: Record<string, unknown>) => string | null,
): unknown[] {
  if (!Array.isArray(value)) {
    issues.push({ field, rule: "array_required" });
    return [];
  }

  const slugs = new Set<string>();
  for (const [index, item] of value.entries()) {
    const itemField = `${field}[${index}]`;
    if (!isRecord(item)) {
      issues.push({ field: itemField, rule: "object_required" });
      continue;
    }
    validate(item, itemField, issues);
    const identity = identityForDuplicate?.(item) ?? (typeof item.slug === "string" ? item.slug : null);
    if (identity !== null) {
      if (slugs.has(identity)) {
        issues.push({ field: `${itemField}.slug`, rule: "duplicate_slug" });
      }
      slugs.add(identity);
    }
  }
  return value;
}

function validateCategoryBrands(
  value: unknown,
  categories: Set<string>,
  brands: Set<string>,
  issues: StaticBuildIssue[],
) {
  if (!isRecord(value)) {
    issues.push({ field: "categoryBrands", rule: "object_required" });
    return;
  }
  for (const [category, references] of Object.entries(value)) {
    validateSlug(category, `categoryBrands.${category}`, issues);
    if (!categories.has(category)) {
      issues.push({ field: `categoryBrands.${category}`, rule: "unknown_category" });
    }
    validateReferences(
      references,
      `categoryBrands.${category}`,
      brands,
      "unknown_brand",
      issues,
    );
  }
}

function validateReferences(
  value: unknown,
  field: string,
  allowed: Set<string>,
  unknownRule: string,
  issues: StaticBuildIssue[],
) {
  if (!Array.isArray(value)) {
    issues.push({ field, rule: "array_required" });
    return;
  }
  const seen = new Set<string>();
  for (const [index, reference] of value.entries()) {
    const referenceField = `${field}[${index}]`;
    if (typeof reference !== "string") {
      issues.push({ field: referenceField, rule: "string_required" });
      continue;
    }
    if (seen.has(reference)) {
      issues.push({ field: referenceField, rule: "duplicate_reference" });
    }
    seen.add(reference);
    if (!allowed.has(reference)) {
      issues.push({ field: referenceField, rule: unknownRule });
    }
  }
}

function validateStringArray(
  value: unknown,
  field: string,
  issues: StaticBuildIssue[],
) {
  if (!Array.isArray(value)) {
    issues.push({ field, rule: "array_required" });
    return;
  }
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string") {
      issues.push({ field: `${field}[${index}]`, rule: "string_required" });
    }
  }
}

function validateImages(
  value: unknown,
  field: string,
  issues: StaticBuildIssue[],
) {
  if (!Array.isArray(value)) {
    issues.push({ field, rule: "array_required" });
    return;
  }
  for (const [index, image] of value.entries()) {
    const imageField = `${field}[${index}]`;
    if (!isRecord(image)) {
      issues.push({ field: imageField, rule: "object_required" });
      continue;
    }
    validateNonEmptyString(image.url, `${imageField}.url`, issues);
    if (image.fallbackUrl !== undefined) {
      validateNonEmptyString(image.fallbackUrl, `${imageField}.fallbackUrl`, issues);
    }
    if (
      image.scale !== undefined &&
      (typeof image.scale !== "number" || !Number.isFinite(image.scale))
    ) {
      issues.push({ field: `${imageField}.scale`, rule: "finite_number_required" });
    }
  }
}

function validateSlug(
  value: unknown,
  field: string,
  issues: StaticBuildIssue[],
) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    /[\\/?#\s]/.test(value)
  ) {
    issues.push({ field, rule: "invalid_slug" });
  }
}

function validateNonEmptyString(
  value: unknown,
  field: string,
  issues: StaticBuildIssue[],
) {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push({ field, rule: "non_empty_string_required" });
  }
}

function slugSet(values: unknown[]): Set<string> {
  return new Set(
    values
      .filter(isRecord)
      .map((value) => value.slug)
      .filter((value): value is string => typeof value === "string"),
  );
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  return (
    month >= 1 && month <= 12 &&
    day >= 1 && day <= daysInMonth[month - 1] &&
    hour <= 23 && minute <= 59 && second <= 59 &&
    offsetHour <= 23 && offsetMinute <= 59 &&
    Number.isFinite(new Date(value).getTime())
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
