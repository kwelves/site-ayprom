"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import Image from "next/image";
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
import { hasAlphaChannel } from "@/lib/admin/image-validation";
import {
  DEFAULT_PRODUCT_PHOTO_MODE,
  PRODUCT_PHOTO_MODE_COOKIE,
  PRODUCT_PHOTO_MODE_COOKIE_MAX_AGE,
  usesScriptProcessing,
  usesWebpOutput,
  type ProductPhotoMode,
} from "@/lib/admin/product-photo-mode";
import { SubmitButton } from "@/components/admin/ui/SubmitButton";
import { BackLink } from "@/components/admin/ui/BackLink";
import { FormField } from "@/components/admin/ui/FormField";
import { Input } from "@/components/admin/ui/Input";
import { Textarea } from "@/components/admin/ui/Textarea";
import { Select } from "@/components/admin/ui/Select";
import { Checkbox } from "@/components/admin/ui/Checkbox";
import { SortableList } from "@/components/admin/SortableList";
import { AdminActionFeedback } from "@/components/admin/ui/AdminActionFeedback";
import { ConfirmDialog } from "@/components/admin/ui/ConfirmDialog";
import { ProductPhotoModeSelect } from "@/components/admin/ProductPhotoModeSelect";
import type { Category, Subcategory, Brand, VehicleType } from "@/types/catalog";
import type { AdminProduct } from "@/lib/admin/queries";

interface ProductFormProps {
  mode: "create" | "edit";
  product?: AdminProduct;
  categories: Category[];
  subcategories: (Subcategory & { categorySlug: string })[];
  brands: Brand[];
  vehicleTypes: VehicleType[];
  /** Server-read cookie value — only used in `mode: "create"`. */
  initialPhotoMode?: ProductPhotoMode;
}

// Best-effort, client-side only: flags photos with no detectable alpha
// channel before they're sent to a script-processing mode, since that
// pipeline crops to the bounding box of non-transparent pixels and does
// nothing useful without one. Never blocks the upload — see
// hasAlphaChannel's own doc comment for why a `null` (undetermined) result
// must not trigger this either.
async function anyFileLacksAlpha(files: FileList): Promise<boolean> {
  for (const file of Array.from(files)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (hasAlphaChannel(bytes, file.type) === false) return true;
  }
  return false;
}

interface CharacteristicRow {
  key: string;
  attribute: string;
  value: string;
}

export function ProductForm({
  mode,
  product,
  categories,
  subcategories,
  brands,
  vehicleTypes,
  initialPhotoMode,
}: ProductFormProps) {
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
  const [photoMode, setPhotoMode] = useState<ProductPhotoMode>(initialPhotoMode ?? DEFAULT_PRODUCT_PHOTO_MODE);
  const [photoAlphaWarning, setPhotoAlphaWarning] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dismissedFormError, setDismissedFormError] = useState<FormActionState>(null);
  const [isUnpublishDialogOpen, setIsUnpublishDialogOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const unpublishConfirmedRef = useRef(false);
  const [, startTransition] = useTransition();

  const selectedCategory = categories.find((c) => c.slug === categorySlug);
  const categorySubcategories = subcategories.filter((s) => s.categorySlug === categorySlug);
  const hotspotCount = product?.hotspotCount ?? 0;
  const requiresUnpublishConfirmation = mode === "edit" && product?.published === true && !published && hotspotCount > 0;

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

  function handlePhotoModeChange(nextMode: ProductPhotoMode) {
    setPhotoMode(nextMode);
    document.cookie = `${PRODUCT_PHOTO_MODE_COOKIE}=${nextMode}; path=/; max-age=${PRODUCT_PHOTO_MODE_COOKIE_MAX_AGE}; SameSite=Lax`;

    const files = photoInputRef.current?.files;
    if (usesScriptProcessing(nextMode) && files && files.length > 0) {
      anyFileLacksAlpha(files).then(setPhotoAlphaWarning);
    } else {
      setPhotoAlphaWarning(false);
    }
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
    setIsUnpublishDialogOpen(true);
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

        <fieldset>
          <legend className="text-sm font-medium text-card-foreground">Совместимые бренды</legend>
          <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
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
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium text-card-foreground">Тип спецтехники</legend>
          <p className="mt-0.5 text-xs text-muted-foreground">На какую технику подходит товар.</p>
          <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
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
        </fieldset>

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
                    <Image
                      src={img.url}
                      alt=""
                      width={48}
                      height={48}
                      className="h-12 w-12 rounded-md bg-muted/40 object-contain"
                    />
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

            <div className="mt-3 max-w-xs">
              <ProductPhotoModeSelect value={photoMode} onChange={handlePhotoModeChange} />
            </div>
            <input type="hidden" name="photoMode" value={photoMode} />

            {photoAlphaWarning && (
              <p role="status" className="mt-3 rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-sm text-warning">
                Похоже, у одного или нескольких выбранных фото нет прозрачного фона. Обрезка по границе детали в этом
                режиме может сработать некорректно — но загрузку это не блокирует.
              </p>
            )}

            <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-input px-4 py-2 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary">
              {pendingPhotoCount > 0 ? `Выбрано фото: ${pendingPhotoCount}` : "Выбрать фото"}
              <input
                ref={photoInputRef}
                type="file"
                name="photos"
                accept="image/jpeg,image/png,image/webp,image/avif"
                multiple
                className="hidden"
                onChange={async (e) => {
                  const input = e.target;
                  const files = input.files;

                  if (usesScriptProcessing(photoMode)) {
                    // The server-side enhance pipeline needs the original
                    // file's own alpha channel (see actions.ts) — skip the
                    // client-side JPEG/WebP re-encode that would flatten it.
                    setPhotoAlphaWarning(files && files.length > 0 ? await anyFileLacksAlpha(files) : false);
                  } else {
                    setPhotoAlphaWarning(false);
                    await compressFileListInput(input, usesWebpOutput(photoMode) ? "image/webp" : "image/jpeg");
                  }
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
      <ConfirmDialog
        open={isUnpublishDialogOpen}
        title="Снять товар с публикации?"
        description={
          <>
            Товар будет отвязан от {hotspotCount} {hotspotCount === 1 ? "хотспота" : "хотспотов"} в разделе «Спецтехника». На
            сайте вместо него появится заглушка.
          </>
        }
        cancelLabel="Отмена"
        confirmLabel="Снять с публикации"
        tone="danger"
        onCancel={closeUnpublishDialog}
        onConfirm={confirmUnpublish}
      />
    </div>
  );
}
