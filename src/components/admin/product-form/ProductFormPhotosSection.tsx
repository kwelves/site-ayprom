"use client";

import { useEffect, useState, type ChangeEvent, type RefObject } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { ImageFallback } from "@/components/ui/ImageFallback";
import { buttonClassName } from "@/components/admin/ui/button-styles";
import { cn } from "@/lib/utils";
import { Input } from "@/components/admin/ui/Input";
import { SortableList } from "@/components/admin/SortableList";
import { ProgressBar } from "@/components/admin/ui/ProgressBar";
import { ProductPhotoModeSelect } from "@/components/admin/ProductPhotoModeSelect";
import { usesScriptProcessing, type ProductPhotoMode } from "@/lib/admin/product-photo-mode";
import { MAX_VISUAL_SCALE, MIN_VISUAL_SCALE, VISUAL_SCALE_STEP } from "@/lib/admin/visual-scale";
import type { AdminProduct } from "@/lib/admin/queries";
import type { StagedPhoto } from "@/lib/admin/use-staged-photo-upload";

interface ProductImage {
  id: string;
  url: string;
  /** Card-context preview (thumbnail_url → gallery_url → url) — used only
   * for the small thumbnail below; `url` stays the master reference shown
   * as text and passed to delete/reorder/scale actions. */
  previewUrl: string;
  order: number;
  scale: number | null;
}

interface ProductFormPhotosSectionProps {
  mode: "create" | "edit";
  product?: AdminProduct;
  images: ProductImage[];
  onImageReorder: (next: ProductImage[]) => void;
  onImageDelete: (imageId: string) => void;
  onImageScaleBlur: (imageId: string, rawValue: string) => void;
  isUploading: boolean;
  onImageUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  photoMode: ProductPhotoMode;
  onPhotoModeChange: (mode: ProductPhotoMode) => void;
  photoAlphaWarning: boolean;
  pendingPhotoCount: number;
  photoInputRef: RefObject<HTMLInputElement | null>;
  onFileInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  isSubmitting: boolean;
  /** QA-004: файлы, уже загруженные в промежуточное хранилище (режим создания). */
  stagedPhotos: StagedPhoto[];
  onStagedRetry: (key: string) => void;
  onStagedCancel: (key: string) => void;
  /** Cloudflare admin: photos waiting for (or given up by) the background worker. */
  photoQueue: { pending: number; failed: number };
}

// Sequential server-side processing (applyPhotoModeToAll) has no real
// progress signal to report — this is a heuristic estimate, not a measured
// one, and stays capped below 100% so it never claims completion before the
// redirect actually happens (see actions.ts's comment on why the pipeline is
// sequential, not this component reinventing that decision).
const ESTIMATED_MS_PER_PHOTO = 1800;
const PROGRESS_TICK_MS = 200;
const MAX_HEURISTIC_PERCENT = 92;

// The drop target for photos: the whole width of the section, so it is easy to hit and reads as the place where
// photos go, with the accepted formats under the action.
function uploadZoneClassName(busy: boolean) {
  return cn(
    "mt-3 flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-[14px] border border-dashed border-input px-4 py-4 text-center text-sm text-foreground transition-[border-color,background-color,color] duration-fast ease-ui hover:border-primary hover:bg-accent hover:text-primary has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-primary/30",
    busy && "pointer-events-none opacity-70",
  );
}

export function ProductFormPhotosSection({
  mode,
  product,
  images,
  onImageReorder,
  onImageDelete,
  onImageScaleBlur,
  isUploading,
  onImageUpload,
  photoMode,
  onPhotoModeChange,
  photoAlphaWarning,
  pendingPhotoCount,
  photoInputRef,
  onFileInputChange,
  isSubmitting,
  stagedPhotos,
  onStagedRetry,
  onStagedCancel,
  photoQueue,
}: ProductFormPhotosSectionProps) {
  const [progressPercent, setProgressPercent] = useState(0);
  const showProgress = isSubmitting && usesScriptProcessing(photoMode) && pendingPhotoCount > 0;

  useEffect(() => {
    // No reset-to-0 branch when showProgress goes false: the bar is only
    // rendered while showProgress is true (see below), so a stale leftover
    // percent is invisible — and on the next submission this effect restarts
    // the interval from a fresh startedAt within one tick (PROGRESS_TICK_MS)
    // anyway.
    if (!showProgress) return;
    const estimatedMs = pendingPhotoCount * ESTIMATED_MS_PER_PHOTO;
    const startedAt = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setProgressPercent(Math.min(MAX_HEURISTIC_PERCENT, (elapsed / estimatedMs) * 100));
    }, PROGRESS_TICK_MS);
    return () => clearInterval(interval);
  }, [showProgress, pendingPhotoCount]);

  if (mode === "edit" && product) {
    return (
      <div>
        {images.length > 0 && (
          <SortableList
            surface="inset"
            items={images}
            getId={(img) => img.id}
            onReorder={onImageReorder}
            enableStepButtons
            renderItem={(img) => (
              <div className="flex items-center gap-3">
                <span className="group/photo relative shrink-0">
                  <span className="relative block size-16 overflow-hidden rounded-[12px] bg-surface-subtle">
                    <ImageFallback
                      src={img.previewUrl}
                      fallbackSrc={img.previewUrl !== img.url ? img.url : undefined}
                      alt=""
                      sizes="64px"
                      unoptimized
                      className="object-contain p-1 transition-[scale] duration-base ease-ui pointer-fine:group-hover/photo:scale-[1.06]"
                    />
                  </span>
                  {img.id === images[0]?.id && (
                    <span className="absolute -top-1.5 -left-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground shadow-sm">
                      Главное
                    </span>
                  )}
                  <span
                    aria-hidden="true"
                    className="glass-float pointer-events-none absolute top-1/2 right-full z-20 mr-3 hidden size-60 origin-right -translate-y-1/2 scale-95 rounded-[18px] p-3 opacity-0 transition-[opacity,scale] duration-fast ease-ui lg:pointer-fine:block pointer-fine:group-hover/photo:scale-100 pointer-fine:group-hover/photo:opacity-100 pointer-fine:group-hover/photo:delay-200 pointer-fine:group-hover/photo:duration-base"
                  >
                    <span className="relative block size-full">
                      <ImageFallback src={img.url} alt="" sizes="240px" unoptimized className="rounded-[12px] object-contain" />
                    </span>
                  </span>
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={img.url}>{img.url}</span>
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground" title="Во сколько раз увеличить деталь на карточке сайта">
                  <span className="sr-only sm:not-sr-only">Масштаб</span>
                  <Input
                    type="number"
                    step={VISUAL_SCALE_STEP}
                    min={MIN_VISUAL_SCALE}
                    max={MAX_VISUAL_SCALE}
                    defaultValue={img.scale ?? undefined}
                    onBlur={(e) => onImageScaleBlur(img.id, e.target.value)}
                    aria-label="Масштаб"
                    placeholder="1"
                    className="w-16 px-2 text-center tabular-nums"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => onImageDelete(img.id)}
                  aria-label="Удалить"
                  title="Удалить фото"
                  className={buttonClassName({ variant: "ghost", size: "icon", className: "hover:bg-danger-surface hover:text-danger" })}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
            )}
          />
        )}
        {images.length === 0 && photoQueue.pending === 0 && (
          <p className="text-sm text-muted-foreground">Фото пока нет. Без фото на сайте стоит нейтральная заглушка.</p>
        )}
        {photoQueue.pending > 0 && (
          <div
            role="status"
            className="mt-3 flex animate-fade-up items-center gap-3 rounded-[12px] border border-border-accent bg-info-surface px-3 py-2.5 text-sm text-info"
          >
            <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin" />
            <span>
              Обрабатывается фото: <span className="font-semibold tabular-nums">{photoQueue.pending}</span>. Они появятся в списке сами, обычно в течение минуты.
            </span>
          </div>
        )}
        {photoQueue.failed > 0 && (
          <p role="alert" className="mt-3 rounded-[12px] border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger">
            Не удалось обработать фото: {photoQueue.failed}. Загрузите {photoQueue.failed === 1 ? "его" : "их"} ещё раз.
          </p>
        )}
        <label className={uploadZoneClassName(isUploading)}>
          {isUploading ? <Loader2 aria-hidden="true" className="size-5 animate-spin" /> : <ImagePlus aria-hidden="true" className="size-5" />}
          <span className="font-semibold">{isUploading ? "Загрузка…" : "Загрузить фото"}</span>
          <span className="text-xs text-muted-foreground">JPEG, PNG, WebP или AVIF · можно несколько</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            multiple
            className="sr-only"
            onChange={onImageUpload}
            disabled={isUploading}
          />
        </label>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs leading-snug text-muted-foreground">
        Необязательно: без фото на сайте стоит нейтральная заглушка. JPEG, PNG, WebP или AVIF.
      </p>

      <div className="mt-3">
        <ProductPhotoModeSelect value={photoMode} onChange={onPhotoModeChange} />
      </div>
      <input type="hidden" name="photoMode" value={photoMode} />

      {photoAlphaWarning && (
        <p role="status" className="mt-3 rounded-[12px] border border-warning-border bg-warning-surface px-3 py-2 text-sm text-warning">
          У некоторых фото, похоже, нет прозрачного фона. В этом режиме обрезка по контуру детали может сработать
          неточно. Загрузку это не останавливает.
        </p>
      )}

      <label className={uploadZoneClassName(false)}>
        <ImagePlus aria-hidden="true" className="size-5" />
        <span className="font-semibold">{pendingPhotoCount > 0 ? `Выбрано фото: ${pendingPhotoCount}` : "Выбрать фото"}</span>
        <span className="text-xs text-muted-foreground">До 10 файлов, каждый до 8 МБ</span>
        {/* Без `name`: файлы больше не попадают в запрос сохранения товара —
            они уже загружены в промежуточное хранилище, а форма присылает
            только ссылки на них. */}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          multiple
          className="sr-only"
          onChange={onFileInputChange}
        />
      </label>

      {/* Ход загрузки по каждому файлу отдельно: админ видит, что именно
          происходит, и может повторить только сорвавшийся снимок, а не всю
          отправку целиком. */}
      {stagedPhotos.length > 0 && (
        <ul className="mt-3 space-y-2">
          {stagedPhotos.map((photo) => (
            <li key={photo.key} className="glass-plate animate-[admin-row-in_var(--transition-duration-base)_var(--ease-ui)_backwards] rounded-[12px] px-3 py-2">
              <div className="flex items-center gap-3">
                <span className="flex-1 truncate text-xs text-muted-foreground">{photo.fileName}</span>
                {photo.status === "uploaded" && (
                  <span className="shrink-0 text-xs text-success">Загружено</span>
                )}
                {photo.status === "failed" && (
                  <button
                    type="button"
                    onClick={() => onStagedRetry(photo.key)}
                    className="shrink-0 text-xs text-primary hover:underline"
                  >
                    Повторить
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onStagedCancel(photo.key)}
                  className="shrink-0 text-xs text-danger hover:underline"
                >
                  {photo.status === "uploading" ? "Отменить" : "Убрать"}
                </button>
              </div>
              {photo.status === "uploading" && (
                <ProgressBar className="mt-2" percent={photo.progress} label={`Загрузка ${photo.progress}%`} />
              )}
              {photo.status === "failed" && photo.error && (
                <p role="alert" className="mt-1 text-xs text-danger">
                  {photo.error}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {showProgress && (
        <ProgressBar
          className="mt-3"
          percent={progressPercent}
          label={`Обрабатывается примерно ${pendingPhotoCount} ${pendingPhotoCount === 1 ? "фото" : "фотографий"}…`}
        />
      )}
    </div>
  );
}
