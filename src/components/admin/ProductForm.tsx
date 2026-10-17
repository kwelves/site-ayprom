"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import {
  createProduct,
  updateProduct,
  deleteProduct,
  uploadProductImage,
  fetchProductPhotoQueue,
  resumePhotoProcessing,
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
import { ProductFormPublicationSection } from "@/components/admin/product-form/ProductFormPublicationSection";
import { AdminPageHeader } from "@/components/admin/ui/AdminPageHeader";
import { FormSection, SectionCount } from "@/components/admin/ui/FormSection";
import { buttonClassName } from "@/components/admin/ui/button-styles";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
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

// The updated_at trigger writes UTC; shown in Bishkek time like the change log.
const EDITED_FORMAT = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bishkek" });

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
  // Cloudflare admin: photos finished in the background; the form follows their progress.
  const [photoQueue, setPhotoQueue] = useState({ pending: 0, failed: 0 });
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
  const successRef = useRef(success);
  useEffect(() => {
    successRef.current = success;
  }, [success]);

  // Cloudflare admin: photos are finished by a background worker. Read the queue once when the form opens
  // (photos may already be waiting), then every few seconds while something is still pending; finished
  // photos join the list on their own. If they wait too long, the worker is started again.
  const productId = mode === "edit" ? product?.id : undefined;
  const hasPendingPhotos = photoQueue.pending > 0;
  useEffect(() => {
    // Only the Cloudflare admin build has a photo queue (vite.admin-spa.config.ts); the Next.js admin finishes
    // photos while saving, and asking the server there would only add a request that saving then cancels.
    if (!productId || process.env.NEXT_PUBLIC_ADMIN_CLOUDFLARE !== "on") return;
    let cancelled = false;
    const applyQueue = (state: Awaited<ReturnType<typeof fetchProductPhotoQueue>>) => {
      if (cancelled) return;
      setImages((prev) => {
        const known = new Set(prev.map((image) => image.id));
        const fresh = state.images.filter((image) => !known.has(image.id));
        if (fresh.length > 0) successRef.current(fresh.length === 1 ? "Фотография обработана" : `Обработано фотографий: ${fresh.length}`);
        return fresh.length > 0 ? [...prev, ...fresh] : prev;
      });
      setPhotoQueue({ pending: state.pending, failed: state.failed });
    };
    fetchProductPhotoQueue(productId).then(applyQueue, () => undefined);
    if (!hasPendingPhotos) {
      return () => {
        cancelled = true;
      };
    }

    const startedAt = Date.now();
    let restarted = false;
    const timer = setInterval(() => {
      fetchProductPhotoQueue(productId).then((state) => {
        applyQueue(state);
        if (!restarted && state.pending > 0 && Date.now() - startedAt > 60_000) {
          restarted = true;
          void resumePhotoProcessing().catch(() => undefined);
        }
      }, () => undefined);
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [productId, hasPendingPhotos]);

  const selectedCategory = categories.find((c) => c.slug === categorySlug);
  const categorySubcategories = subcategories.filter((s) => s.categorySlug === categorySlug);
  const hotspotCount = product?.hotspotCount ?? 0;
  const requiresUnpublishConfirmation = mode === "edit" && product?.published === true && !published && hotspotCount > 0;
  // On a laptop (xl) publication and availability sit in the pinned action bar beside Save; below that they stay a
  // block of the form. They are real form fields, so exactly one of the two places is rendered.
  const publicationInBar = useMediaQuery("(min-width: 1280px)");
  const publicationProps = {
    mode,
    published,
    onPublishedChange: setPublished,
    hotspotCount,
    availability,
    onAvailabilityChange: setAvailability,
  };

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
      const finished = uploaded.filter((image): image is Exclude<typeof image, { pending: true }> => !("pending" in image));
      const queuedNow = uploaded.length - finished.length;
      if (finished.length > 0) {
        setImages((prev) => [...prev, ...finished]);
        success(finished.length === 1 ? "Фотография добавлена" : `Добавлено фотографий: ${finished.length}`);
      }
      if (queuedNow > 0) {
        setPhotoQueue((prev) => ({ ...prev, pending: prev.pending + queuedNow }));
        success(queuedNow === 1 ? "Фотография загружена и обрабатывается" : `Фотографий в обработке: ${queuedNow}`);
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
    <div className="pb-4">
      <BackLink href="/admin/products" label="Товары" />

      <form ref={formRef} action={formAction} onSubmit={handleFormSubmit} className="mt-3">
        <AdminPageHeader
          title={mode === "create" ? "Новый товар" : (product?.name ?? "Товар")}
          description={
            mode === "create" ? (
              "Достаточно основного: название и категория. Остальное можно добавить позже."
            ) : (
              <>
                {product?.article && (
                  <>
                    {"Арт. "}
                    <span className="tabular-nums slashed-zero">{product.article}</span>
                    {" · "}
                  </>
                )}
                {"изменено "}
                <span className="tabular-nums">{product ? EDITED_FORMAT.format(new Date(product.updatedAt)) : ""}</span>
              </>
            )
          }
        />

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

        {/* Every part is open: what is filled in is visible without a click. On a laptop the wide column holds the
            texts, the side column what is changed most often (publication, photos, compatibility). On narrower
            screens the parts stack in the order of work: the wrappers dissolve (display: contents) and order-* sets
            the sequence. */}
        <div className="mt-5 flex flex-col gap-5 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] xl:items-stretch">
          <div className="contents xl:flex xl:flex-col xl:gap-5">
            <FormSection id="product-basic" title="Основное" className="order-1">
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
              />
            </FormSection>

            <FormSection id="product-descriptions" title="Описание" description="Что покупатель читает на странице товара." className="order-5">
              <ProductFormDescriptionsSection product={product} />
            </FormSection>

            <FormSection
              id="product-characteristics"
              title="Характеристики"
              aside={characteristics.some((c) => c.attribute.trim()) ? <SectionCount>{characteristics.filter((c) => c.attribute.trim()).length}</SectionCount> : undefined}
              description="Перетащите строку, чтобы изменить порядок на сайте."
              className="order-6"
            >
              <ProductFormCharacteristicsSection
                characteristics={characteristics}
                onReorder={setCharacteristics}
                onUpdate={updateCharacteristic}
                onRemove={removeCharacteristic}
                onAdd={addCharacteristic}
              />
            </FormSection>

            <FormSection id="product-seo" title="SEO" description="Как товар выглядит в поиске Google и Яндекса." className="order-7 xl:flex-1">
              <ProductFormSeoSection product={product} />
            </FormSection>
          </div>

          <div className="contents xl:flex xl:flex-col xl:gap-5">
            {!publicationInBar && (
              <FormSection id="product-publication" title="Публикация" className="order-2">
                <ProductFormPublicationSection {...publicationProps} />
              </FormSection>
            )}

            <FormSection
              id="product-photos"
              title="Фотографии"
              aside={(mode === "edit" ? images.length : stagedPhotos.photos.length) > 0 ? <SectionCount>{mode === "edit" ? images.length : stagedPhotos.photos.length}</SectionCount> : undefined}
              description={mode === "edit" ? "Первое фото главное. Порядок меняется перетаскиванием." : undefined}
              className="order-3"
            >
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
                photoQueue={photoQueue}
                isSubmitting={isSubmitting}
              />
            </FormSection>

            <FormSection
              id="product-compatibility"
              title="Совместимость"
              aside={selectedBrands.size + selectedVehicleTypes.size > 0 ? <SectionCount>{selectedBrands.size + selectedVehicleTypes.size}</SectionCount> : undefined}
              className="order-4 xl:flex-1"
            >
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
            </FormSection>
          </div>
        </div>

        <StickyFormActions>
          {mode === "edit" && (
            <button
              type="button"
              onClick={handleDeleteProduct}
              title="Удалить товар"
              className={buttonClassName({ variant: "ghost", className: "text-danger hover:bg-danger-surface hover:text-danger" })}
            >
              <Trash2 aria-hidden="true" />
              {/* On a 1280px laptop the bar also carries publication and availability, so the word gives way to the icon. */}
              <span className="max-sm:sr-only xl:max-2xl:sr-only">Удалить товар</span>
            </button>
          )}
          {publicationInBar && (
            <div className={cn("min-w-0", mode === "edit" && "xl:ml-3")}>
              <ProductFormPublicationSection variant="bar" {...publicationProps} />
            </div>
          )}
          <span className="ml-auto hidden items-center gap-1.5 text-xs text-muted-foreground 2xl:inline-flex">
            <kbd className="rounded-[6px] bg-surface-strong px-1.5 py-0.5 font-sans text-[11px] font-medium">Ctrl S</kbd>
            сохранить
          </span>
          <Link href="/admin/products" className={buttonClassName({ variant: "glass", className: "max-sm:hidden max-md:ml-auto" })}>
            Отмена
          </Link>
          <SubmitButton pendingLabel={mode === "create" ? "Создание…" : "Сохранение…"} className="max-sm:flex-1">
            {mode === "create" ? "Создать товар" : "Сохранить"}
          </SubmitButton>
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
