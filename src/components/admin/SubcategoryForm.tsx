"use client";

import { useState } from "react";
import { createSubcategory, updateSubcategory, deleteSubcategory, replaceSubcategoryImage } from "@/lib/admin/actions";
import { slugify } from "@/lib/admin/slugify";
import { BackLink } from "@/components/admin/ui/BackLink";
import { FormField } from "@/components/admin/ui/FormField";
import { Input } from "@/components/admin/ui/Input";
import { Textarea } from "@/components/admin/ui/Textarea";
import type { AdminSubcategory } from "@/lib/admin/queries";

interface SubcategoryFormProps {
  mode: "create" | "edit";
  categorySlug: string;
  categoryName: string;
  subcategory?: AdminSubcategory;
}

export function SubcategoryForm({ mode, categorySlug, categoryName, subcategory }: SubcategoryFormProps) {
  const [name, setName] = useState(subcategory?.name ?? "");
  const [slug, setSlug] = useState(subcategory?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(false);
  const [image, setImage] = useState(subcategory?.image ?? "");
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  function handleNameChange(value: string) {
    setName(value);
    if (mode === "create" && !slugTouched) {
      setSlug(slugify(value));
    }
  }

  async function handleImageReplace(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !subcategory) return;

    setIsUploadingImage(true);
    const formData = new FormData();
    formData.set("file", file);
    const newUrl = await replaceSubcategoryImage(subcategory.id, formData);
    if (newUrl) setImage(newUrl);
    setIsUploadingImage(false);
    event.target.value = "";
  }

  function handleDeleteSubcategory() {
    if (!subcategory) return;
    if (subcategory.productCount > 0) {
      alert(
        `Нельзя удалить «${subcategory.name}» — в ней ${subcategory.productCount} товар(ов). Сначала перенесите или удалите их.`
      );
      return;
    }
    if (!confirm(`Удалить подкатегорию «${subcategory.name}»? Это действие необратимо.`)) return;
    deleteSubcategory(subcategory.id);
  }

  const action =
    mode === "create"
      ? createSubcategory.bind(null, categorySlug)
      : updateSubcategory.bind(null, categorySlug, subcategory!.slug);

  return (
    <div className="max-w-xl">
      <BackLink href={`/admin/categories/${categorySlug}/subcategories`} label="Подкатегории" />

      <form action={action} className="mt-4 space-y-6">
        <div>
          <p className="text-sm text-muted-foreground">{categoryName}</p>
          <h1 className="text-xl font-semibold text-foreground">
            {mode === "create" ? "Новая подкатегория" : `Редактировать: ${subcategory?.name}`}
          </h1>
        </div>

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
            <Input id="slug-display" value={subcategory?.slug ?? ""} disabled />
          </FormField>
        )}

        <FormField
          label="Вступление"
          htmlFor="intro"
          description="Необязательно — короткий поясняющий текст на странице подкатегории."
        >
          <Textarea id="intro" name="intro" rows={3} defaultValue={subcategory?.intro} />
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
              <input type="file" name="image" accept="image/*" required className="text-sm" />
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

        <div className="flex items-center gap-4 border-t border-border pt-6">
          <button
            type="submit"
            className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-blue-700"
          >
            {mode === "create" ? "Создать подкатегорию" : "Сохранить"}
          </button>
          {mode === "edit" && (
            <button type="button" onClick={handleDeleteSubcategory} className="text-sm text-red-600 hover:underline">
              Удалить подкатегорию
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
