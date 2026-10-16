"use client";

import { FormField } from "@/components/admin/ui/FormField";
import { Input } from "@/components/admin/ui/Input";
import { Select } from "@/components/admin/ui/Select";
import type { Category, Subcategory } from "@/types/catalog";
import type { AdminProduct } from "@/lib/admin/queries";

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
}

// What identifies the product, in the order it is filled in: the name, then its address and article side by side,
// then where it lives in the catalog.
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
}: ProductFormBasicSectionProps) {
  const hasSubcategories = selectedCategory?.type === "subcategory";
  return (
    <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
      <FormField label="Название" htmlFor="name" required className="sm:col-span-2">
        <Input
          id="name"
          name="name"
          required
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          className="font-medium sm:h-11 sm:text-[15px]"
        />
      </FormField>

      <FormField
        label="Адрес (slug)"
        htmlFor="slug"
        required={mode === "edit"}
        description={mode === "create"
          ? "Заполняется из названия, можно изменить."
          : "Новый адрес меняет ссылку на товар, старая перестанет открываться. Латиница, цифры и дефисы."}
      >
        <Input
          id="slug"
          name="slug"
          required={mode === "edit"}
          value={slug}
          onChange={(e) => onSlugChange(e.target.value)}
          spellCheck={false}
          className="font-mono text-[13px]"
        />
      </FormField>

      <FormField label="Артикул" htmlFor="article">
        <Input id="article" name="article" defaultValue={product?.article} spellCheck={false} className="tabular-nums slashed-zero" />
      </FormField>

      <FormField label="Категория" htmlFor="categorySlug" required className={hasSubcategories ? undefined : "sm:col-span-2"}>
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

      {hasSubcategories && (
        <FormField
          label="Подкатегория"
          htmlFor="subcategorySlug"
          description="Без подкатегории товар стоит отдельной карточкой в общей сетке категории."
        >
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
    </div>
  );
}
