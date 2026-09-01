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
import { hasAlphaChannel } from "@/lib/admin/image-validation";
import { useStagedPhotoUpload } from "@/lib/admin/use-staged-photo-upload";
import {
  DEFAULT_PRODUCT_PHOTO_MODE,
  PRODUCT_PHOTO_MODE_COOKIE,
  PRODUCT_PHOTO_MODE_COOKIE_MAX_AGE,
  usesScriptProcessing,
  usesWebpOutput,
  type ProductPhotoMode,
} from "@/lib/admin/product-photo-mode";
import { DEFAULT_PRODUCT_AVAILABILITY, type ProductAvailability } from "@/lib/admin/product-availability";
import { SubmitButton } from "@/components/admin/ui/SubmitButton";
import { BackLink } from "@/components/admin/ui/BackLink";
import { Collapsible } from "@/components/admin/ui/Collapsible";
import { StickyFormActions } from "@/components/admin/ui/StickyFormActions";
import { AdminActionFeedback } from "@/components/admin/ui/AdminActionFeedback";
import { ConfirmDialog } from "@/components/admin/ui/ConfirmDialog";
import { useAdminToast } from "@/components/admin/ui/AdminToastProvider";
import { ProductFormBasicSection } from "@/components/admin/product-form/ProductFormBasicSection";
import { ProductFormCompatibilitySection } from "@/components/admin/product-form/ProductFormCompatibilitySection";
import { ProductFormDescriptionsSection } from "@/components/admin/product-form/ProductFormDescriptionsSection";
import { ProductFormCharacteristicsSection } from "@/components/admin/product-form/ProductFormCharacteristicsSection";
import { ProductFormPhotosSection } from "@/components/admin/product-form/ProductFormPhotosSection";
import { ProductFormSeoSection } from "@/components/admin/product-form/ProductFormSeoSection";
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
  const [availability, setAvailability] = useState<ProductAvailability>(
    product?.availability ?? DEFAULT_PRODUCT_AVAILABILITY
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
  // QA-004: при создании товара фотографии грузятся отдельно и заранее, а не
  // внутри общего запроса сохранения. Идентификатор сессии живёт столько же,
  // сколько открытая форма, и связывает загруженное с этой попыткой.
  const [photoDraftId] = useState(() => crypto.randomUUID());
  const stagedPhotos = useStagedPhotoUpload(photoDraftId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dismissedFormError, setDismissedFormError] = useState<FormActionState>(null);
  const [isUnpublishDialogOpen, setIsUnpublishDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const unpublishConfirmedRef = useRef(false);
  const [, startTransition] = useTransition();
  const { success } = useAdminToast();

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

  function handleSlugChange(value: string) {
    setSlug(value);
    setSlugTouched(true);
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

  function toggleAllBrands() {
    setSelectedBrands((prev) => (prev.size === brands.length ? new Set() : new Set(brands.map((b) => b.slug))));
  }

  function toggleVehicleType(vehicleTypeSlug: string) {
    setSelectedVehicleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(vehicleTypeSlug)) next.delete(vehicleTypeSlug);
      else next.add(vehicleTypeSlug);
      return next;
    });
  }

  function toggleAllVehicleTypes() {
    setSelectedVehicleTypes((prev) =>
      prev.size === vehicleTypes.length ? new Set() : new Set(vehicleTypes.map((v) => v.slug))
    );
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
        success(uploaded.length === 1 ? "Фотография добавлена" : `Добавлено фотографий: ${uploaded.length}`);
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
        success("Фотография удалена");
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
        success("Порядок фотографий сохранён");
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
        success("Масштаб фотографии сохранён");
      } catch {
        setImages(previous);
        setActionError("Не удалось сохранить масштаб фотографии. Значение восстановлено.");
      }
    });
  }

  async function handleFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const files = input.files;

    if (usesScriptProcessing(photoMode)) {
      // The server-side enhance pipeline needs the original file's own
      // alpha channel (see actions.ts) — skip the client-side JPEG/WebP
      // re-encode that would flatten it.
      setPhotoAlphaWarning(files && files.length > 0 ? await anyFileLacksAlpha(files) : false);
    } else {
      setPhotoAlphaWarning(false);
      try {
        await compressFileListInput(input, usesWebpOutput(photoMode) ? "image/webp" : "image/jpeg");
      } catch (error) {
        input.value = "";
        setActionError(error instanceof Error ? error.message : "Не удалось подготовить фотографию к загрузке.");
        return;
      }
    }

    // Загрузка начинается сразу после выбора, не дожидаясь сохранения товара:
    // так админ видит ход по каждому файлу и может повторить неудачный, а не
    // получает один долгий непрозрачный запрос в конце.
    const selected = Array.from(input.files ?? []);
    if (selected.length > 0) {
      const rejection = stagedPhotos.addFiles(selected);
      if (rejection) setActionError(rejection);
    }
    // Ввод очищается: файлы уже приняты в свой список и не должны уехать
    // повторно внутри формы.
    input.value = "";
    setPendingPhotoCount(0);
  }

  function handleDeleteProduct() {
    if (!product) return;
    setIsDeleteDialogOpen(true);
  }

  function confirmDeleteProduct() {
    if (!product) return;
    setIsDeleteDialogOpen(false);
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
  const [formState, formAction, isSubmitting] = useActionState(boundAction, null);
  const displayedError =
    actionError ?? (formState !== dismissedFormError ? (formState?.error ?? null) : null);

  // Cmd/Ctrl+S saves the form — the only hotkey besides Esc (which
  // ConfirmDialog/QuickViewPanel already own) PROJECT_BRIEF calls for.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        formRef.current?.requestSubmit();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="max-w-3xl pb-4">
      <BackLink href="/admin/products" label="Товары" />

      <form ref={formRef} action={formAction} onSubmit={handleFormSubmit} className="mt-4 space-y-4">
        <h1 className="text-xl font-semibold text-foreground">
          {mode === "create" ? "Новый товар" : `Редактировать: ${product?.name}`}
        </h1>

        {/* Версия товара на момент открытия формы. Сервер сверяет её перед
            записью, поэтому правка из устаревшей вкладки не затирает молча
            более новую редакцию. Значение передаётся строкой без разбора в
            Date: JS обрезал бы микросекунды и сравнение всегда падало бы. */}
        {product && <input type="hidden" name="expectedUpdatedAt" value={product.updatedAt} />}

        {/* Файлы в запрос сохранения больше не попадают — только ссылки на уже
            загруженное, в том порядке, в котором админ их расставил. */}
        {mode === "create" && (
          <>
            <input type="hidden" name="photoDraftId" value={photoDraftId} />
            <input type="hidden" name="photoStagingIds" value={stagedPhotos.stagingIds.join(",")} />
          </>
        )}

        <Collapsible title="Основное" defaultOpen>
          <ProductFormBasicSection
            mode={mode}
            product={product}
            name={name}
            onNameChange={handleNameChange}
            slug={slug}
            onSlugChange={handleSlugChange}
            categorySlug={categorySlug}
            onCategoryChange={handleCategoryChange}
            subcategorySlug={subcategorySlug}
            onSubcategoryChange={setSubcategorySlug}
            categories={categories}
            categorySubcategories={categorySubcategories}
            selectedCategory={selectedCategory}
            published={published}
            onPublishedChange={setPublished}
            hotspotCount={hotspotCount}
            availability={availability}
            onAvailabilityChange={setAvailability}
          />
        </Collapsible>

        <Collapsible title="Совместимость" description="Бренды и типы спецтехники" defaultOpen={false}>
          <ProductFormCompatibilitySection
            brands={brands}
            selectedBrands={selectedBrands}
            onToggleBrand={toggleBrand}
            onToggleAllBrands={toggleAllBrands}
            vehicleTypes={vehicleTypes}
            selectedVehicleTypes={selectedVehicleTypes}
            onToggleVehicleType={toggleVehicleType}
            onToggleAllVehicleTypes={toggleAllVehicleTypes}
          />
        </Collapsible>

        <Collapsible title="Описания" defaultOpen={false}>
          <ProductFormDescriptionsSection product={product} />
        </Collapsible>

        <Collapsible title="Характеристики" defaultOpen={false}>
          <ProductFormCharacteristicsSection
            characteristics={characteristics}
            onReorder={setCharacteristics}
            onUpdate={updateCharacteristic}
            onRemove={removeCharacteristic}
            onAdd={addCharacteristic}
          />
        </Collapsible>

        <Collapsible title="Фотографии" defaultOpen={false}>
          <ProductFormPhotosSection
            mode={mode}
            product={product}
            images={images}
            onImageReorder={handleImageReorder}
            onImageDelete={handleImageDelete}
            onImageScaleBlur={handleImageScaleBlur}
            isUploading={isUploading}
            onImageUpload={handleImageUpload}
            photoMode={photoMode}
            onPhotoModeChange={handlePhotoModeChange}
            photoAlphaWarning={photoAlphaWarning}
            pendingPhotoCount={pendingPhotoCount}
            photoInputRef={photoInputRef}
            onFileInputChange={handleFileInputChange}
            stagedPhotos={stagedPhotos.photos}
            onStagedRetry={stagedPhotos.retry}
            onStagedCancel={stagedPhotos.cancel}
            isSubmitting={isSubmitting}
          />
        </Collapsible>

        <Collapsible title="SEO" defaultOpen={false}>
          <ProductFormSeoSection product={product} />
        </Collapsible>

        <StickyFormActions>
          <SubmitButton pendingLabel={mode === "create" ? "Создание…" : "Сохранение…"}>
            {mode === "create" ? "Создать товар" : "Сохранить"}
          </SubmitButton>
          {mode === "edit" && (
            <button type="button" onClick={handleDeleteProduct} className="text-sm text-danger hover:underline">
              Удалить товар
            </button>
          )}
        </StickyFormActions>
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
      <ConfirmDialog
        open={isDeleteDialogOpen}
        title={`Удалить товар «${product?.name}»?`}
        description="Это действие необратимо."
        cancelLabel="Отмена"
        confirmLabel="Удалить"
        tone="danger"
        onCancel={() => setIsDeleteDialogOpen(false)}
        onConfirm={confirmDeleteProduct}
      />
    </div>
  );
}
