// The stage photo can intentionally overflow its measuring box on compact
// screens (`VehicleVisual.scale`). Keep every use of next/image on this
// exact responsive contract so a preload or idle warmup reuses the visible
// stage's optimized CDN response instead of requesting another rendition.
export const VEHICLE_STAGE_IMAGE_SIZES = "(max-width: 639px) 135vw, (max-width: 1023px) 90vw, 55vw";
