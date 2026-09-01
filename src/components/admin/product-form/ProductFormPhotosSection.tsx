"use client";

import { useEffect, useState, type ChangeEvent, type RefObject } from "react";
import Image from "next/image";
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
}

// Sequential server-side processing (applyPhotoModeToAll) has no real
// progress signal to report — this is a heuristic estimate, not a measured
// one, and stays capped below 100% so it never claims completion before the
// redirect actually happens (see actions.ts's comment on why the pipeline is
// sequential, not this component reinventing that decision).
const ESTIMATED_MS_PER_PHOTO = 1800;
const PROGRESS_TICK_MS = 200;
const MAX_HEURISTIC_PERCENT = 92;

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
            items={images}
            getId={(img) => img.id}
            onReorder={onImageReorder}
            enableStepButtons
            renderItem={(img) => (
              <div className="flex items-center gap-3">
                <Image
                  src={img.previewUrl}
                  alt=""
                  width={48}
                  height={48}
                  unoptimized
                  className="h-12 w-12 rounded-md bg-muted/40 object-contain"
                />
                <span className="flex-1 truncate text-xs text-muted-foreground">{img.url}</span>
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  Масштаб
                  <Input
                    type="number"
                    step={VISUAL_SCALE_STEP}
                    min={MIN_VISUAL_SCALE}
                    max={MAX_VISUAL_SCALE}
                    defaultValue={img.scale ?? undefined}
                    onBlur={(e) => onImageScaleBlur(img.id, e.target.value)}
                    className="w-20"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => onImageDelete(img.id)}
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
            onChange={onImageUpload}
            disabled={isUploading}
          />
        </label>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-muted-foreground">
        Необязательно: товар без фото поддерживается и будет показан с нейтральной заглушкой. До 10 файлов JPEG,
        PNG, WebP или AVIF, не более 8 МБ каждый.
      </p>

      <div className="mt-3 max-w-xs">
        <ProductPhotoModeSelect value={photoMode} onChange={onPhotoModeChange} />
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
        {/* Без `name`: файлы больше не попадают в запрос сохранения товара —
            они уже загружены в промежуточное хранилище, а форма присылает
            только ссылки на них. */}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          multiple
          className="hidden"
          onChange={onFileInputChange}
        />
      </label>

      {/* Ход загрузки по каждому файлу отдельно: админ видит, что именно
          происходит, и может повторить только сорвавшийся снимок, а не всю
          отправку целиком. */}
      {stagedPhotos.length > 0 && (
        <ul className="mt-3 space-y-2">
          {stagedPhotos.map((photo) => (
            <li key={photo.key} className="rounded-md border border-border px-3 py-2">
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
