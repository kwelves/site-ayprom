/**
 * Описание фотографии техники на сцене витрины.
 *
 * Тип живёт в отдельном модуле, потому что его нужен и серверной заглушке
 * (VehicleShowcaseShell), и клиентскому интерактиву, и таблице
 * `src/lib/vehicle-visuals.ts`. Отдельный файл гарантирует, что импорт типа
 * ни при каких настройках сборщика не потянет за собой тяжёлый интерактивный
 * модуль, который загружается отдельным чанком.
 */
export interface VehicleVisual {
  image: string;
  /** Smaller pre-built variant for viewports below the `lg` breakpoint (see
   * scripts/generate-vehicle-webp.mjs's `-mobile.webp` output). The stage
   * shows the photo noticeably smaller there, so the full-resolution file is
   * wasted bytes — falls back to `image` when absent. `naturalWidth`/
   * `naturalHeight` below describe the source crop's aspect ratio only, not
   * which file is fetched, so they stay the same regardless of this pick. */
  imageMobile?: string;
  naturalWidth: number;
  naturalHeight: number;
  /** How far beyond strict contain-fit to inflate the photo (1 = fits
   * exactly). Hotspots track this same scaled rect, so they stay pinned to
   * their equipment regardless of the value. */
  scale?: number;
  /** Overrides `scale` at the lg breakpoint, where the stage's height comes
   * from available flex space (see STAGE_ASPECT_CLASS) instead of a fixed
   * aspect-ratio box — the same inflate factor that fits a tall aspect-video
   * box can overflow a much shorter one. Defaults to `scale`. */
  desktopScale?: number;
}
