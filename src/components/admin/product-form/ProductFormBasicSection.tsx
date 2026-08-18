"use client";

import { FormField } from "@/components/admin/ui/FormField";
import { Input } from "@/components/admin/ui/Input";
import { Select } from "@/components/admin/ui/Select";
import { Checkbox } from "@/components/admin/ui/Checkbox";
import { SegmentedControl } from "@/components/admin/ui/SegmentedControl";
import {
  PRODUCT_AVAILABILITY_LABELS,
  PRODUCT_AVAILABILITY_OPTIONS,
  type ProductAvailability,
} from "@/lib/admin/product-availability";
import type { Category, Subcategory } from "@/types/catalog";
import type { AdminProduct } from "@/lib/admin/queries";

const AVAILABILITY_TONE: Record<ProductAvailability, string> = {
  in_stock: "bg-success-surface text-success",
  out_of_stock: "bg-danger-surface text-danger",
  unclear: "bg-warning-surface text-warning",
};

const AVAILABILITY_OPTIONS = PRODUCT_AVAILABILITY_OPTIONS.map((value) => ({
  value,
  label: PRODUCT_AVAILABILITY_LABELS[value],
  activeClassName: AVAILABILITY_TONE[value],
}));

interface ProductFormBasicSectionProps {
  mode: "create" | "edit";
  product?: AdminProduct;
  name: string;
  onNameChange: (value: string) => void;
  slug: string;
  onSlugChange: (value: string) => void;
  categorySlug: string;
  onCategoryChange: (value: string) => void;
  subcategorySlug: string;
  onSubcategoryChange: (value: string) => void;
  categories: Category[];
  categorySubcategories: (Subcategory & { categorySlug: string })[];
  selectedCategory?: Category;
  published: boolean;
  onPublishedChange: (value: boolean) => void;
  hotspotCount: number;
  availability: ProductAvailability;
  onAvailabilityChange: (value: ProductAvailability) => void;
}

export function ProductFormBasicSection({
  mode,
  product,
  name,
  onNameChange,
  slug,
  onSlugChange,
  categorySlug,
  onCategoryChange,
  subcategorySlug,
  onSubcategoryChange,
  categories,
  categorySubcategories,
  selectedCategory,
  published,
  onPublishedChange,
  hotspotCount,
  availability,
  onAvailabilityChange,
}: ProductFormBasicSectionProps) {
  return (
    <>
      <FormField label="Название" htmlFor="name">
        <Input id="name" name="name" required value={name} onChange={(e) => onNameChange(e.target.value)} />
      </FormField>

      {mode === "create" ? (
        <FormField
          label="Адрес (slug)"
          htmlFor="slug"
          description="Заполняется автоматически из названия, можно изменить."
        >
          <Input id="slug" name="slug" value={slug} onChange={(e) => onSlugChange(e.target.value)} />
        </FormField>
      ) : (
        <FormField
          label="Адрес (slug)"
          htmlFor="slug-display"
          description="Нельзя изменить — используется в ссылках на товар."
        >
          <Input id="slug-display" value={product?.slug ?? ""} disabled />
        </FormField>
      )}

      <FormField label="Категория" htmlFor="categorySlug">
        <Select
          id="categorySlug"
          name="categorySlug"
          required
          value={categorySlug}
          onChange={(e) => onCategoryChange(e.target.value)}
        >
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </Select>
      </FormField>

      {selectedCategory?.type === "subcategory" && (
        <FormField label="Подкатегория" htmlFor="subcategorySlug">
          <Select
            id="subcategorySlug"
            name="subcategorySlug"
            value={subcategorySlug}
            onChange={(e) => onSubcategoryChange(e.target.value)}
          >
            <option value="">Без подкатегории</option>
            {categorySubcategories.map((sub) => (
              <option key={sub.slug} value={sub.slug}>
                {sub.name}
              </option>
            ))}
          </Select>
        </FormField>
      )}

      <FormField label="Артикул" htmlFor="article">
        <Input id="article" name="article" defaultValue={product?.article} />
      </FormField>

      <div>
        <span className="block text-sm font-medium text-card-foreground">Наличие</span>
        <div className="mt-1.5">
          <SegmentedControl
            aria-label="Статус наличия"
            options={AVAILABILITY_OPTIONS}
            value={availability}
            onChange={onAvailabilityChange}
          />
          <input type="hidden" name="availability" value={availability} />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Информационная метка — не скрывает товар из каталога и поиска на сайте.
        </p>
      </div>

      <div>
        <Checkbox
          id="published"
          name="published"
          label="Опубликован (виден на сайте)"
          checked={published}
          onChange={(event) => onPublishedChange(event.target.checked)}
        />
        {mode === "edit" && !published && hotspotCount > 0 && (
          <p role="status" className="mt-2 rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-sm text-warning">
            Снятие с публикации отвяжет товар от {hotspotCount} {hotspotCount === 1 ? "хотспота" : "хотспотов"} в разделе «Спецтехника».
          </p>
        )}
      </div>
    </>
  );
}
