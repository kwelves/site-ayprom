// Confirmation-dialog wording for admin delete buttons.
//
// These live apart from src/lib/admin/queries.ts on purpose. They are pure
// formatters — already-fetched counts in, string out, no I/O — but they are
// called from Client Components ("use client"), while queries.ts imports the
// service-role Supabase client. Sharing one module put queries.ts (and with
// it the service-role import) into the client bundle graph. The key value
// itself never reached the browser (Next.js replaces non-NEXT_PUBLIC_ env
// reads with `undefined` client-side), but the import edge was real and made
// a future leak one careless refactor away. Keeping them separate lets
// queries.ts stay `server-only`.
//
// Types are imported with `import type`, which TypeScript erases — so this
// module keeps no runtime dependency on queries.ts.
import type { AdminBrand, AdminCategory, AdminVehicleType } from "@/lib/admin/queries";

// Shared by BrandsList and BrandForm's delete buttons — deleting a brand
// cascades away its product_brands/category_brands rows silently, so both
// confirmation dialogs need to say what's actually at stake.
export function describeBrandUsage(brand: AdminBrand): string {
  const parts: string[] = [];
  if (brand.productCount > 0) parts.push(`${brand.productCount} товар(ах)`);
  if (brand.categoryCount > 0) parts.push(`${brand.categoryCount} категории(ях)`);
  return parts.length > 0 ? ` Бренд используется в ${parts.join(" и ")} — эти связи тоже исчезнут.` : "";
}

// Shared by CategoriesList and CategoryForm's delete buttons. Products are
// deliberately not mentioned here — the DB's FK on products.category_slug
// has no cascade, so deleting a category with products fails outright
// rather than silently orphaning them; the caller checks productCount
// separately to block the attempt before it hits that error.
export function describeCategoryUsage(category: AdminCategory): string {
  const parts: string[] = [];
  if (category.subcategoryCount > 0) parts.push(`${category.subcategoryCount} подкатегори(ях)`);
  if (category.categoryBrandCount > 0) parts.push(`${category.categoryBrandCount} привязанных бренд(ах)`);
  return parts.length > 0 ? ` В категории есть ${parts.join(" и ")} — они тоже удалятся.` : "";
}

// Shared by VehicleTypesList and VehicleTypeForm's delete buttons — same
// reasoning as describeBrandUsage.
export function describeVehicleTypeUsage(vehicleType: AdminVehicleType): string {
  return vehicleType.productCount > 0
    ? ` Тип используется в ${vehicleType.productCount} товар(ах) — эта связь тоже исчезнет.`
    : "";
}
