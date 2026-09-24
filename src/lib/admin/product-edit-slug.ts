import { slugify } from "@/lib/admin/slugify";

export function resolveProductEditSlug(value: FormDataEntryValue | null, currentSlug: string): string {
  if (value === null) return currentSlug;
  const slug = typeof value === "string" ? slugify(value) : "";
  if (!slug) throw new Error("Укажите адрес товара: латинские буквы, цифры и дефисы.");
  return slug;
}
