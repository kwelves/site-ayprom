"use client";

import { useActionState, useState } from "react";
import Image from "next/image";
import { createSubcategory, updateSubcategory, deleteSubcategory, replaceSubcategoryImage } from "@/lib/admin/actions";
import type { FormActionState } from "@/lib/admin/actions";
import { slugify } from "@/lib/admin/slugify";
import { compressFileInput } from "@/lib/admin/compress-image";
import { useImageReplace } from "@/lib/admin/use-image-replace";
import { formatRussianCount } from "@/lib/russian-plural";
import { BackLink } from "@/components/admin/ui/BackLink";
import { SubmitButton } from "@/components/admin/ui/SubmitButton";
import { FormField } from "@/components/admin/ui/FormField";
import { Input } from "@/components/admin/ui/Input";
import { Textarea } from "@/components/admin/ui/Textarea";
import { AdminActionFeedback } from "@/components/admin/ui/AdminActionFeedback";
import { ConfirmDialog } from "@/components/admin/ui/ConfirmDialog";
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
  const [dismissedError, setDismissedError] = useState<FormActionState>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const { isUploading: isUploadingImage, handleReplace: handleImageReplace } = useImageReplace(
    (formData) => replaceSubcategoryImage(subcategory!.id, formData),
    setImage
  );

  function handleNameChange(value: string) {
    setName(value);
    if (mode === "create" && !slugTouched) {
      setSlug(slugify(value));
    }
  }

  function handleDeleteSubcategory() {
    if (!subcategory) return;
    if (subcategory.productCount > 0) {
      alert(
        `Нельзя удалить «${subcategory.name}» — в ней ${formatRussianCount(subcategory.productCount, ["товар", "товара", "товаров"])}. Сначала перенесите или удалите их.`
      );
      return;
    }
    setIsDeleteDialogOpen(true);
  }

  function confirmDeleteSubcategory() {
    if (!subcategory) return;
    setIsDeleteDialogOpen(false);
    deleteSubcategory(subcategory.id);
  }

  const boundAction =
    mode === "create"
      ? createSubcategory.bind(null, categorySlug)
      : updateSubcategory.bind(null, categorySlug, subcategory!.slug);
  const [formState, formAction] = useActionState(boundAction, null);
  const actionError = formState !== dismissedError ? (formState?.error ?? null) : null;

  return (
    <div className="max-w-xl">
      <BackLink href={`/admin/categories/${categorySlug}/subcategories`} label="Подкатегории" />

      <form action={formAction} className="mt-4 space-y-6">
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
              <Image src={image} alt="" width={160} height={96} className="h-full w-full object-cover" />
            </div>
          )}
          {mode === "create" ? (
            <div className="mt-3">
              <label htmlFor="image" className="sr-only">
                Изображение
              </label>
              <input
                id="image"
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
            <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-input px-4 py-2 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary">
              {isUploadingImage ? "Загрузка…" : "Заменить изображение"}
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
          <SubmitButton pendingLabel={mode === "create" ? "Создание…" : "Сохранение…"}>
            {mode === "create" ? "Создать подкатегорию" : "Сохранить"}
          </SubmitButton>
          {mode === "edit" && (
            <button type="button" onClick={handleDeleteSubcategory} className="text-sm text-danger hover:underline">
              Удалить подкатегорию
            </button>
          )}
        </div>
      </form>
      <AdminActionFeedback message={actionError} onDismiss={() => setDismissedError(formState)} />
      <ConfirmDialog
        open={isDeleteDialogOpen}
        title={`Удалить подкатегорию «${subcategory?.name}»?`}
        description="Это действие необратимо."
        cancelLabel="Отмена"
        confirmLabel="Удалить"
        tone="danger"
        onCancel={() => setIsDeleteDialogOpen(false)}
        onConfirm={confirmDeleteSubcategory}
      />
    </div>
  );
}
