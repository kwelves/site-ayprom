"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import {
  createProduct,
  updateProduct,
  deleteProduct,
  uploadProductImage,
  deleteProductImage,
  reorderProductImages,
  updateProductImageScale,
} from "@/lib/admin/actions";
import type { FormActionState } from "@/lib/admin/actions";
import { slugify } from "@/lib/admin/slugify";
import { compressImage, compressFileListInput } from "@/lib/admin/compress-image";
import { SubmitButton } from "@/components/admin/ui/SubmitButton";
import { BackLink } from "@/components/admin/ui/BackLink";
import { FormField } from "@/components/admin/ui/FormField";
import { Input } from "@/components/admin/ui/Input";
import { Textarea } from "@/components/admin/ui/Textarea";
import { Select } from "@/components/admin/ui/Select";
import { Checkbox } from "@/components/admin/ui/Checkbox";
import { SortableList } from "@/components/admin/SortableList";
import { AdminActionFeedback } from "@/components/admin/ui/AdminActionFeedback";
import type { Category, Subcategory, Brand, VehicleType } from "@/types/catalog";
import type { AdminProduct } from "@/lib/admin/queries";

interface ProductFormProps {
  mode: "create" | "edit";
  product?: AdminProduct;
  categories: Category[];
  subcategories: (Subcategory & { categorySlug: string })[];
  brands: Brand[];
  vehicleTypes: VehicleType[];
}

interface CharacteristicRow {
  key: string;
  attribute: string;
  value: string;
}

export function ProductForm({ mode, product, categories, subcategories, brands, vehicleTypes }: ProductFormProps) {
  const [name, setName] = useState(product?.name ?? "");
  const [slug, setSlug] = useState(product?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(false);
  const [categorySlug, setCategorySlug] = useState(product?.category ?? categories[0]?.slug ?? "");
  const [subcategorySlug, setSubcategorySlug] = useState(product?.subcategory ?? "");
  const [selectedBrands, setSelectedBrands] = useState<Set<string>>(new Set(product?.compatibleBrands ?? []));
  const [selectedVehicleTypes, setSelectedVehicleTypes] = useState<Set<string>>(
    new Set(product?.vehicleTypes ?? [])
  );
  const [characteristics, setCharacteristics] = useState<CharacteristicRow[]>(
    (product?.characteristics ?? []).map((c) => ({ key: c.id, attribute: c.attribute, value: c.value }))
  );
  const [images, setImages] = useState(product?.images ?? []);
  const [published, setPublished] = useState(product?.published ?? true);
  const [isUploading, setIsUploading] = useState(false);
  const [pendingPhotoCount, setPendingPhotoCount] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dismissedFormError, setDismissedFormError] = useState<FormActionState>(null);
  const [isUnpublishDialogOpen, setIsUnpublishDialogOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelUnpublishButtonRef = useRef<HTMLButtonElement>(null);
  const submitTriggerRef = useRef<HTMLElement | null>(null);
  const unpublishConfirmedRef = useRef(false);
  const [, startTransition] = useTransition();

  const selectedCategory = categories.find((c) => c.slug === categorySlug);
  const categorySubcategories = subcategories.filter((s) => s.categorySlug === categorySlug);
  const hotspotCount = product?.hotspotCount ?? 0;
  const requiresUnpublishConfirmation = mode === "edit" && product?.published === true && !published && hotspotCount > 0;

  useEffect(() => {
    if (isUnpublishDialogOpen) cancelUnpublishButtonRef.current?.focus();
  }, [isUnpublishDialogOpen]);

  function handleNameChange(value: string) {
    setName(value);
    if (mode === "create" && !slugTouched) {
      setSlug(slugify(value));
    }
  }

  function handleCategoryChange(value: string) {
    setCategorySlug(value);
    setSubcategorySlug("");
  }

  function toggleBrand(brandSlug: string) {
    setSelectedBrands((prev) => {
      const next = new Set(prev);
      if (next.has(brandSlug)) next.delete(brandSlug);
      else next.add(brandSlug);
      return next;
    });
  }

  function toggleVehicleType(vehicleTypeSlug: string) {
    setSelectedVehicleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(vehicleTypeSlug)) next.delete(vehicleTypeSlug);
      else next.add(vehicleTypeSlug);
      return next;
    });
  }

  function addCharacteristic() {
    setCharacteristics((prev) => [...prev, { key: crypto.randomUUID(), attribute: "", value: "" }]);
  }

  function updateCharacteristic(key: string, field: "attribute" | "value", value: string) {
    setCharacteristics((prev) => prev.map((c) => (c.key === key ? { ...c, [field]: value } : c)));
  }

  function removeCharacteristic(key: string) {
    setCharacteristics((prev) => prev.filter((c) => c.key !== key));
  }

  async function handleImageUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files || files.length === 0 || !product) return;

    setIsUploading(true);
    setActionError(null);
    try {
      const startOrder = images.length;
      const uploads = await Promise.all(
        Array.from(files).map(async (file, index) => {
          const compressed = await compressImage(file);
          const formData = new FormData();
          formData.set("file", compressed);
          return uploadProductImage(product.id, formData, startOrder + index);
        }),
      );
      const uploaded = uploads.filter((image): image is NonNullable<typeof image> => image !== null);
      if (uploaded.length > 0) {
        setImages((prev) => [...prev, ...uploaded]);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Не удалось загрузить фотографии.");
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  }

  function handleImageDelete(imageId: string) {
    const previous = images;
    setImages((prev) => prev.filter((img) => img.id !== imageId));
    setActionError(null);
    startTransition(async () => {
      try {
        await deleteProductImage(imageId);
      } catch {
        setImages(previous);
        setActionError("Не удалось удалить фотографию. Она возвращена в список.");
      }
    });
  }

  function handleImageReorder(newImages: typeof images) {
    const previous = images;
    setImages(newImages);
    if (!product) return;
    setActionError(null);
    startTransition(async () => {
      try {
        await reorderProductImages(product.slug, newImages.map((img) => img.id));
      } catch {
        setImages(previous);
        setActionError("Не удалось сохранить порядок фотографий. Порядок восстановлен.");
      }
    });
  }

  function handleImageScaleBlur(imageId: string, rawValue: string) {
    if (!product) return;
    const parsed = rawValue.trim() ? Number(rawValue) : null;
    const value = parsed !== null && Number.isFinite(parsed) ? parsed : null;
    const previous = images;
    setImages((prev) => prev.map((img) => (img.id === imageId ? { ...img, scale: value } : img)));
    setActionError(null);
    startTransition(async () => {
      try {
        await updateProductImageScale(product.slug, imageId, value);
      } catch {
        setImages(previous);
        setActionError("Не удалось сохранить масштаб фотографии. Значение восстановлено.");
      }
    });
  }

  function handleDeleteProduct() {
    if (!product) return;
    if (!confirm(`Удалить товар «${product.name}»? Это действие необратимо.`)) return;
    startTransition(() => {
      deleteProduct(product.slug);
    });
  }

  function closeUnpublishDialog() {
    setIsUnpublishDialogOpen(false);
    requestAnimationFrame(() => submitTriggerRef.current?.focus());
  }

  function confirmUnpublish() {
    unpublishConfirmedRef.current = true;
    setIsUnpublishDialogOpen(false);
    formRef.current?.requestSubmit();
  }

  function handleFormSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (unpublishConfirmedRef.current) {
      unpublishConfirmedRef.current = false;
      return;
    }
    if (!requiresUnpublishConfirmation) return;

    event.preventDefault();
    submitTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setIsUnpublishDialogOpen(true);
  }

  function handleUnpublishDialogKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeUnpublishDialog();
      return;
    }
    if (event.key !== "Tab") return;

    const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
    if (!buttons || buttons.length === 0) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const boundAction = mode === "create" ? createProduct : updateProduct.bind(null, product!.slug);
  const [formState, formAction] = useActionState(boundAction, null);
  const displayedError =
    actionError ?? (formState !== dismissedFormError ? (formState?.error ?? null) : null);

  return (
    <div className="max-w-3xl">
      <BackLink href="/admin/products" label="Товары" />

      <form ref={formRef} action={formAction} onSubmit={handleFormSubmit} className="mt-4 space-y-6">
        <h1 className="text-xl font-semibold text-foreground">
          {mode === "create" ? "Новый товар" : `Редактировать: ${product?.name}`}
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
            onChange={(e) => handleCategoryChange(e.target.value)}
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
              onChange={(e) => setSubcategorySlug(e.target.value)}
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

        <FormField label="Совместимые бренды" htmlFor="compatibleBrands-list">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {brands.map((brand) => (
              <Checkbox
                key={brand.slug}
                id={`brand-${brand.slug}`}
                name="compatibleBrands"
                value={brand.slug}
                label={brand.name}
                checked={selectedBrands.has(brand.slug)}
                onChange={() => toggleBrand(brand.slug)}
              />
            ))}
          </div>
        </FormField>

        <FormField label="Тип спецтехники" htmlFor="vehicleTypes-list" description="На какую технику подходит товар.">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {vehicleTypes.map((vehicleType) => (
              <Checkbox
                key={vehicleType.slug}
                id={`vehicle-type-${vehicleType.slug}`}
                name="vehicleTypes"
                value={vehicleType.slug}
                label={vehicleType.name}
                checked={selectedVehicleTypes.has(vehicleType.slug)}
                onChange={() => toggleVehicleType(vehicleType.slug)}
              />
            ))}
          </div>
        </FormField>

        <FormField label="Краткое описание" htmlFor="shortDescription" description="Показывается в карточке товара.">
          <Textarea id="shortDescription" name="shortDescription" required rows={2} defaultValue={product?.shortDescription} />
        </FormField>

        <FormField label="Полное описание" htmlFor="description">
          <Textarea id="description" name="description" rows={5} defaultValue={product?.description} />
        </FormField>

        <FormField label="Артикул" htmlFor="article">
          <Input id="article" name="article" defaultValue={product?.article} />
        </FormField>

        <div>
          <Checkbox
            id="published"
            name="published"
            label="Опубликован (виден на сайте)"
            checked={published}
            onChange={(event) => setPublished(event.target.checked)}
          />
          {mode === "edit" && !published && hotspotCount > 0 && (
            <p role="status" className="mt-2 rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-sm text-warning">
              Снятие с публикации отвяжет товар от {hotspotCount} {hotspotCount === 1 ? "хотспота" : "хотспотов"} в разделе «Спецтехника».
            </p>
          )}
        </div>

        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Характеристики</h2>
          {characteristics.length > 0 && (
            <SortableList
              className="mt-3"
              items={characteristics}
              getId={(c) => c.key}
              onReorder={setCharacteristics}
              renderItem={(c) => (
                <div className="flex items-center gap-2">
                  <Input
                    name="characteristicAttribute"
                    placeholder="Атрибут"
                    value={c.attribute}
                    onChange={(e) => updateCharacteristic(c.key, "attribute", e.target.value)}
                    className="flex-1"
                  />
                  <Input
                    name="characteristicValue"
                    placeholder="Значение"
                    value={c.value}
                    onChange={(e) => updateCharacteristic(c.key, "value", e.target.value)}
                    className="flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => removeCharacteristic(c.key)}
                    className="shrink-0 text-sm text-danger hover:underline"
                  >
                    Удалить
                  </button>
                </div>
              )}
            />
          )}
          <button type="button" onClick={addCharacteristic} className="mt-3 text-sm text-primary hover:underline">
            + Добавить характеристику
          </button>
        </div>

        {mode === "edit" && product ? (
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Фотографии</h2>
            {images.length > 0 && (
              <SortableList
                className="mt-3"
                items={images}
                getId={(img) => img.id}
                onReorder={handleImageReorder}
                renderItem={(img) => (
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element -- Supabase Storage is an external host, simpler than configuring next/image remotePatterns for an internal tool */}
                    <img src={img.url} alt="" className="h-12 w-12 rounded-md bg-muted/40 object-contain" />
                    <span className="flex-1 truncate text-xs text-muted-foreground">{img.url}</span>
                    <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                      Масштаб
                      <Input
                        type="number"
                        step="0.05"
                        defaultValue={img.scale ?? undefined}
                        onBlur={(e) => handleImageScaleBlur(img.id, e.target.value)}
                        className="w-20"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => handleImageDelete(img.id)}
                      className="shrink-0 text-sm text-danger hover:underline"
                    >
                      Удалить
                    </button>
                  </div>
                )}
              />
            )}
            <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-input px-4 py-2 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary">
              {isUploading ? "Загрузка…" : "Загрузить фото"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                multiple
                className="hidden"
                onChange={handleImageUpload}
                disabled={isUploading}
              />
            </label>
          </div>
        ) : (
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Фотографии</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Необязательно: товар без фото поддерживается и будет показан с нейтральной заглушкой. До 10 файлов JPEG,
              PNG, WebP или AVIF, не более 8 МБ каждый.
            </p>
            <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-input px-4 py-2 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary">
              {pendingPhotoCount > 0 ? `Выбрано фото: ${pendingPhotoCount}` : "Выбрать фото"}
              <input
                type="file"
                name="photos"
                accept="image/jpeg,image/png,image/webp,image/avif"
                multiple
                className="hidden"
                onChange={async (e) => {
                  const input = e.target;
                  await compressFileListInput(input);
                  setPendingPhotoCount(input.files?.length ?? 0);
                }}
              />
            </label>
          </div>
        )}

        <div className="flex items-center gap-4 border-t border-border pt-6">
          <SubmitButton pendingLabel={mode === "create" ? "Создание…" : "Сохранение…"}>
            {mode === "create" ? "Создать товар" : "Сохранить"}
          </SubmitButton>
          {mode === "edit" && (
            <button type="button" onClick={handleDeleteProduct} className="text-sm text-danger hover:underline">
              Удалить товар
            </button>
          )}
        </div>
      </form>
      <AdminActionFeedback
        message={displayedError}
        onDismiss={() => {
          setActionError(null);
          setDismissedFormError(formState);
        }}
      />
      {isUnpublishDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4">
          <div
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="unpublish-hotspots-title"
            aria-describedby="unpublish-hotspots-description"
            onKeyDown={handleUnpublishDialogKeyDown}
            className="w-full max-w-md rounded-lg border border-warning-border bg-card p-5 shadow-lg"
          >
            <h2 id="unpublish-hotspots-title" className="text-base font-semibold text-card-foreground">
              Снять товар с публикации?
            </h2>
            <p id="unpublish-hotspots-description" className="mt-2 text-sm text-muted-foreground">
              Товар будет отвязан от {hotspotCount} {hotspotCount === 1 ? "хотспота" : "хотспотов"} в разделе «Спецтехника».
              На сайте вместо него появится заглушка.
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                ref={cancelUnpublishButtonRef}
                type="button"
                onClick={closeUnpublishDialog}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-card-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={confirmUnpublish}
                className="rounded-md border border-danger-border bg-danger-surface px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
              >
                Снять с публикации
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
