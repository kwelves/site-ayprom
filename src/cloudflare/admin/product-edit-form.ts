// No-JavaScript HTML edit form for one product in the thin admin. Every value
// is escaped; the page carries no script and is served with a CSP without
// script-src. Parsing is strict (known keys only, bounded sizes) and mirrors
// the legacy Next form: trimmed text, empty optional text → null, slugified
// address, characteristic rows kept only when both halves are filled.
import { slugify } from "@/lib/admin/slugify";
import {
  isProductAvailability, PRODUCT_AVAILABILITY_LABELS, PRODUCT_AVAILABILITY_OPTIONS, type ProductAvailability,
} from "@/lib/admin/product-availability";
import {
  ADMIN_PRODUCT_TIMESTAMP, isAdminProductSlug, MAX_ADMIN_PRODUCT_RELATIONS, type AdminProductDetail,
} from "./product-detail-reader";
import type { ProductMutationFields } from "./product-mutation-ports";
import { readFormFields } from "./request";

/** Same ceiling as the JSON PUT body. */
export const MAX_PRODUCT_EDIT_FORM_BYTES = 64 * 1024;
const EMPTY_CHARACTERISTIC_ROWS = 3;
const SINGLE_FIELDS = {
  expectedUpdatedAt: 64, slug: 300, name: 500, categorySlug: 200, subcategorySlug: 200, article: 200,
  shortDescription: 5_000, description: 50_000, availability: 32, metaTitle: 500, metaDescription: 2_000,
  compatibleBrands: 20_000, vehicleTypes: 20_000,
} as const;
const CHARACTERISTIC_MAX_LENGTH = 1_000;
const RELATION_SLUG_MAX_LENGTH = 200;
const ALLOWED_KEYS = new Set([...Object.keys(SINGLE_FIELDS), "published", "characteristicAttribute", "characteristicValue"]);

/** What the form shows and posts back; on an error the typed values are re-rendered. */
export interface ProductEditValues {
  expectedUpdatedAt: string;
  slug: string;
  name: string;
  categorySlug: string;
  subcategorySlug: string;
  shortDescription: string;
  description: string;
  article: string;
  published: boolean;
  availability: ProductAvailability;
  metaTitle: string;
  metaDescription: string;
  characteristics: { attribute: string; value: string }[];
  compatibleBrands: string;
  vehicleTypes: string;
}

export type ProductEditSubmission =
  | { values: ProductEditValues; input: { newSlug: string; expectedUpdatedAt: string; fields: ProductMutationFields } }
  | { values: ProductEditValues; message: string };

export function productEditValues(detail: AdminProductDetail): ProductEditValues {
  return {
    expectedUpdatedAt: detail.updatedAt,
    slug: detail.slug,
    name: detail.name,
    categorySlug: detail.categorySlug,
    subcategorySlug: detail.subcategorySlug ?? "",
    shortDescription: detail.shortDescription,
    description: detail.description ?? "",
    article: detail.article ?? "",
    published: detail.published,
    availability: detail.availability,
    metaTitle: detail.metaTitle ?? "",
    metaDescription: detail.metaDescription ?? "",
    characteristics: detail.characteristics,
    compatibleBrands: detail.compatibleBrands.join(", "),
    vehicleTypes: detail.vehicleTypes.join(", "),
  };
}

// Browsers submit textarea line breaks as CRLF; the legacy form stores LF.
const lineBreaks = (value: string) => value.replace(/\r\n?/g, "\n");

function relationList(value: string): string[] | null {
  const items = value.split(/[\s,]+/).filter(Boolean);
  return items.length <= MAX_ADMIN_PRODUCT_RELATIONS && items.every((item) => item.length <= RELATION_SLUG_MAX_LENGTH)
    ? items : null;
}

/**
 * Returns null for a structurally invalid body (wrong type, oversized, unknown
 * or repeated keys, malformed version): nothing to re-render, plain 400.
 */
export async function readProductEditSubmission(request: Request): Promise<ProductEditSubmission | null> {
  const form = await readFormFields(request, MAX_PRODUCT_EDIT_FORM_BYTES);
  if (!form) return null;
  for (const key of new Set(form.keys())) if (!ALLOWED_KEYS.has(key)) return null;
  const single: Record<string, string> = {};
  for (const [key, maxLength] of Object.entries(SINGLE_FIELDS)) {
    const all = form.getAll(key);
    if (all.length !== 1 || all[0].length > maxLength) return null;
    single[key] = lineBreaks(all[0]);
  }
  const published = form.getAll("published");
  if (published.length > 1 || (published.length === 1 && published[0] !== "on")) return null;
  if (!ADMIN_PRODUCT_TIMESTAMP.test(single.expectedUpdatedAt) || !isProductAvailability(single.availability)) return null;
  const attributes = form.getAll("characteristicAttribute");
  const characteristicValues = form.getAll("characteristicValue");
  if (attributes.length !== characteristicValues.length || attributes.length > MAX_ADMIN_PRODUCT_RELATIONS
    || [...attributes, ...characteristicValues].some((item) => item.length > CHARACTERISTIC_MAX_LENGTH)) return null;
  const compatibleBrands = relationList(single.compatibleBrands);
  const vehicleTypes = relationList(single.vehicleTypes);
  if (!compatibleBrands || !vehicleTypes) return null;

  const values: ProductEditValues = {
    expectedUpdatedAt: single.expectedUpdatedAt,
    slug: single.slug,
    name: single.name,
    categorySlug: single.categorySlug,
    subcategorySlug: single.subcategorySlug,
    shortDescription: single.shortDescription,
    description: single.description,
    article: single.article,
    published: published.length === 1,
    availability: single.availability as ProductAvailability,
    metaTitle: single.metaTitle,
    metaDescription: single.metaDescription,
    characteristics: attributes.map((attribute, index) => ({ attribute, value: characteristicValues[index] })),
    compatibleBrands: single.compatibleBrands,
    vehicleTypes: single.vehicleTypes,
  };
  const name = values.name.trim();
  const categorySlug = values.categorySlug.trim();
  if (!name || !categorySlug) return { values, message: "Заполните обязательные поля: название, категория." };
  const newSlug = slugify(values.slug);
  if (!isAdminProductSlug(newSlug)) return { values, message: "Укажите адрес товара: латинские буквы, цифры и дефисы." };
  const optional = (value: string) => value.trim() || null;
  return {
    values,
    input: {
      newSlug,
      expectedUpdatedAt: values.expectedUpdatedAt,
      fields: {
        slugBase: newSlug,
        name,
        categorySlug,
        subcategorySlug: optional(values.subcategorySlug),
        shortDescription: values.shortDescription.trim(),
        description: optional(values.description),
        article: optional(values.article),
        published: values.published,
        availability: values.availability,
        metaTitle: optional(values.metaTitle),
        metaDescription: optional(values.metaDescription),
        characteristics: values.characteristics
          .map((row) => ({ attribute: lineBreaks(row.attribute).trim(), value: lineBreaks(row.value).trim() }))
          .filter((row) => row.attribute && row.value),
        compatibleBrands,
        vehicleTypes,
      },
    },
  };
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escape(title)} — AYPROM</title></head><body><main>
${body}
<form method="post" action="/api/admin/logout"><button type="submit">Выйти</button></form></main></body></html>`;
}

const input = (label: string, name: keyof typeof SINGLE_FIELDS, value: string, required = false) =>
  `<p><label>${label} <input name="${name}" maxlength="${SINGLE_FIELDS[name]}" value="${escape(value)}"${required ? " required" : ""}></label></p>`;
// The HTML parser drops exactly one newline right after <textarea>; emitting it
// keeps a value that itself starts with a newline intact.
const textarea = (label: string, name: keyof typeof SINGLE_FIELDS, value: string) =>
  `<p><label>${label}<br><textarea name="${name}" maxlength="${SINGLE_FIELDS[name]}" rows="4" cols="60">\n${escape(value)}</textarea></label></p>`;

export interface ProductEditPageState {
  /** The slug in the URL; the form always posts back to it. */
  currentSlug: string;
  values: ProductEditValues;
  canSave: boolean;
  notice?: "saved";
  error?: "conflict" | "invalid" | "unavailable" | "disabled" | { message: string };
  hotspotCount?: number;
}

const ERRORS = {
  conflict: "Товар изменён в другом окне или другим администратором. Ваши правки не сохранены: откройте актуальную версию и внесите их заново.",
  invalid: "Проверьте адрес, категорию, подкатегорию, бренды и типы техники: значения должны существовать и не повторяться, а адрес не должен быть занят другим товаром. Если товар удалён, вернитесь к списку.",
  unavailable: "Не удалось сохранить товар. Попробуйте позже.",
  disabled: "Сохранение отключено в этом окружении: ещё нет механизма обновления публичных страниц после изменения товара.",
} as const;

export function renderProductEditPage(state: ProductEditPageState): string {
  const { values } = state;
  const editUrl = `/admin/products/${encodeURIComponent(state.currentSlug)}/edit`;
  const error = state.error === undefined ? "" : typeof state.error === "object" ? state.error.message : ERRORS[state.error];
  const rows = [
    ...values.characteristics,
    ...Array.from({ length: Math.min(EMPTY_CHARACTERISTIC_ROWS, MAX_ADMIN_PRODUCT_RELATIONS - values.characteristics.length) }, () => ({ attribute: "", value: "" })),
  ].map((row) => `<li><label>Название <input name="characteristicAttribute" maxlength="${CHARACTERISTIC_MAX_LENGTH}" value="${escape(row.attribute)}"></label> <label>Значение <input name="characteristicValue" maxlength="${CHARACTERISTIC_MAX_LENGTH}" value="${escape(row.value)}"></label></li>`).join("");
  const options = PRODUCT_AVAILABILITY_OPTIONS.map((option) =>
    `<option value="${option}"${option === values.availability ? " selected" : ""}>${escape(PRODUCT_AVAILABILITY_LABELS[option])}</option>`).join("");
  const hotspots = state.hotspotCount && values.published
    ? `<p>Товар показан на витрине техники (точек: ${state.hotspotCount}). Если снять публикацию, эти точки будут отвязаны.</p>` : "";
  return page(`Редактирование: ${values.name || state.currentSlug}`, `<h1>Редактирование товара</h1>
<p><a href="/admin/products">К списку товаров</a></p>
${state.notice === "saved" ? '<p role="status">Изменения сохранены.</p>' : ""}
${error ? `<p role="alert">${escape(error)}</p>` : ""}
${state.error === "conflict" ? `<p><a href="${editUrl}">Открыть актуальную версию</a></p>` : ""}
${state.canSave ? "<p>Изменения попадут на публичный сайт только после пересборки статических страниц.</p>" : `<p role="note">${ERRORS.disabled}</p>`}
${hotspots}
<form method="post" action="${editUrl}"><fieldset${state.canSave ? "" : " disabled"}>
<input type="hidden" name="expectedUpdatedAt" value="${escape(values.expectedUpdatedAt)}">
${input("Адрес (slug)", "slug", values.slug, true)}
${input("Название", "name", values.name, true)}
${input("Артикул", "article", values.article)}
${input("Категория (slug)", "categorySlug", values.categorySlug, true)}
${input("Подкатегория (slug, можно пусто)", "subcategorySlug", values.subcategorySlug)}
${textarea("Краткое описание", "shortDescription", values.shortDescription)}
${textarea("Описание", "description", values.description)}
<p><label><input type="checkbox" name="published"${values.published ? " checked" : ""}> Опубликован</label></p>
<p><label>Наличие <select name="availability">${options}</select></label></p>
${input("SEO title", "metaTitle", values.metaTitle)}
${textarea("SEO description", "metaDescription", values.metaDescription)}
<fieldset><legend>Характеристики</legend><ul>${rows}</ul><p>Строка сохраняется, только если заполнены обе части.</p></fieldset>
${input("Совместимые бренды (slug через запятую)", "compatibleBrands", values.compatibleBrands)}
${input("Типы техники (slug через запятую)", "vehicleTypes", values.vehicleTypes)}
<p><button type="submit">Сохранить</button></p>
</fieldset></form>
<p>Фотографии в этой форме не редактируются.</p>`);
}

export function renderProductEditMessage(title: string, message: string): string {
  return page(title, `<h1>${escape(title)}</h1><p role="alert">${escape(message)}</p><p><a href="/admin/products">К списку товаров</a></p>`);
}

export const PRODUCT_EDIT_DISABLED_MESSAGE = ERRORS.disabled;
