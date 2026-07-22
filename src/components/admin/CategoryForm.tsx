"use client";

import { useState } from "react";
import Link from "next/link";
import { createCategory, updateCategory, deleteCategory, replaceCategoryImage } from "@/lib/admin/actions";
import { describeCategoryUsage } from "@/lib/admin/queries";
import { slugify } from "@/lib/admin/slugify";
import { compressFileInput } from "@/lib/admin/compress-image";
import { useImageReplace } from "@/lib/admin/use-image-replace";
import { BackLink } from "@/components/admin/ui/BackLink";
import { SubmitButton } from "@/components/admin/ui/SubmitButton";
import { FormField } from "@/components/admin/ui/FormField";
import { Input } from "@/components/admin/ui/Input";
import { Textarea } from "@/components/admin/ui/Textarea";
import { Select } from "@/components/admin/ui/Select";
import type { AdminCategory } from "@/lib/admin/queries";
import type { CategoryIcon } from "@/types/catalog";

const ICON_OPTIONS: { value: CategoryIcon; label: string }[] = [
  { value: "hydraulic-pump", label: "Гидронасос" },
  { value: "pto", label: "КОМ (коробка отбора мощности)" },
  { value: "pto-shaft", label: "ВОМ (вал отбора мощности)" },
  { value: "tank", label: "Бак" },
];

interface CategoryFormProps {
  mode: "create" | "edit";
  category?: AdminCategory;
}

export function CategoryForm({ mode, category }: CategoryFormProps) {
  const [name, setName] = useState(category?.name ?? "");
  const [slug, setSlug] = useState(category?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(false);
  const [image, setImage] = useState(category?.image ?? "");
  const { isUploading: isUploadingImage, handleReplace: handleImageReplace } = useImageReplace(
    (formData) => replaceCategoryImage(category!.slug, formData),
    setImage
  );

  function handleNameChange(value: string) {
    setName(value);
    if (mode === "create" && !slugTouched) {
      setSlug(slugify(value));
    }
  }

  function handleDeleteCategory() {
    if (!category) return;
    if (category.productCount > 0) {
      alert(
        `Нельзя удалить «${category.name}» — в категории ${category.productCount} товар(ов). Сначала перенесите или удалите их.`
      );
      return;
    }
    if (!confirm(`Удалить категорию «${category.name}»?${describeCategoryUsage(category)} Это действие необратимо.`)) return;
    deleteCategory(category.slug);
  }

  const action = mode === "create" ? createCategory : updateCategory.bind(null, category!.slug);

  return (
    <div className="max-w-2xl">
      <BackLink href="/admin/categories" label="Категории" />

      <form action={action} className="mt-4 space-y-6">
        <h1 className="text-xl font-semibold text-foreground">
          {mode === "create" ? "Новая категория" : `Редактировать: ${category?.name}`}
        </h1>

        <FormField label="Название" htmlFor="name">
          <Input id="name" name="name" required value={name} onChange={(e) => handleNameChange(e.target.value)} />
        </FormField>

        {mode === "create" ? (
          <FormField
            label="Адрес (slug)"
            htmlFor="slug"
            description="Заполняется автоматически из названия, можно изменить."
          >
            <Input
              id="slug"
              name="slug"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugTouched(true);
              }}
            />
          </FormField>
        ) : (
          <FormField label="Адрес (slug)" htmlFor="slug-display" description="Нельзя изменить — используется в ссылках.">
            <Input id="slug-display" value={category?.slug ?? ""} disabled />
          </FormField>
        )}

        <FormField label="Иконка" htmlFor="icon">
          <Select id="icon" name="icon" defaultValue={category?.icon ?? ICON_OPTIONS[0].value}>
            {ICON_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>

        {mode === "create" ? (
          <FormField
            label="Тип категории"
            htmlFor="type"
            description="«По подкатегориям» — товары делятся на подразделы (как Гидронасосы). «По брендам» — товары показываются сразу по маркам техники (как КОМ/ВОМ). Нельзя изменить после создания — от этого зависит, что показывать на странице категории."
          >
            <Select id="type" name="type" defaultValue="subcategory">
              <option value="subcategory">По подкатегориям</option>
              <option value="brand">По брендам</option>
            </Select>
          </FormField>
        ) : (
          <FormField
            label="Тип категории"
            htmlFor="type-display"
            description="Нельзя изменить — определяет структуру страницы категории."
          >
            <Input
              id="type-display"
              value={category?.type === "brand" ? "По брендам" : "По подкатегориям"}
              disabled
            />
          </FormField>
        )}

        <FormField label="Описание" htmlFor="description" description="Показывается в каталоге и меню.">
          <Textarea id="description" name="description" required rows={2} defaultValue={category?.description} />
        </FormField>

        <FormField
          label="Вступление"
          htmlFor="intro"
          description="Необязательно — короткий поясняющий текст на странице категории (актуально для категорий «по брендам»)."
        >
          <Textarea id="intro" name="intro" rows={3} defaultValue={category?.intro} />
        </FormField>

        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Изображение</h2>
          {mode === "edit" && image && (
            <div className="mt-3 flex h-24 w-40 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40">
              {/* eslint-disable-next-line @next/next/no-img-element -- possibly hosted on Supabase Storage (external host) */}
              <img src={image} alt="" className="h-full w-full object-cover" />
            </div>
          )}
          {mode === "create" ? (
            <div className="mt-3">
              <input
                type="file"
                name="image"
                accept="image/*"
                required
                className="text-sm"
                onChange={(e) => {
                  const input = e.target;
                  void compressFileInput(input);
                }}
              />
            </div>
          ) : (
            <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-300 px-4 py-2 text-sm text-slate-600 transition-colors hover:border-primary hover:text-primary">
              {isUploadingImage ? "Загрузка..." : "Заменить изображение"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageReplace}
                disabled={isUploadingImage}
              />
            </label>
          )}
        </div>

        {mode === "edit" && category && (
          <div>
            {category.type === "subcategory" ? (
              <Link
                href={`/admin/categories/${category.slug}/subcategories`}
                className="text-sm text-primary hover:underline"
              >
                Управлять подкатегориями ({category.subcategoryCount}) →
              </Link>
            ) : (
              <Link
                href={`/admin/categories/${category.slug}/category-brands`}
                className="text-sm text-primary hover:underline"
              >
                Управлять брендами категории ({category.categoryBrandCount}) →
              </Link>
            )}
          </div>
        )}

        <div className="flex items-center gap-4 border-t border-border pt-6">
          <SubmitButton pendingLabel={mode === "create" ? "Создание..." : "Сохранение..."}>
            {mode === "create" ? "Создать категорию" : "Сохранить"}
          </SubmitButton>
          {mode === "edit" && (
            <button type="button" onClick={handleDeleteCategory} className="text-sm text-red-600 hover:underline">
              Удалить категорию
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
