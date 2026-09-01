/**
 * Общая логика выбора URL товарного изображения между master и его
 * WebP-вариантами (thumbnail 640px/q72, gallery 1600px/q82 — см.
 * supabase/migrations/20260901093151_product_image_variants.sql).
 *
 * Правила приоритета — карточка/admin-превью против галереи/zoom/OG/sitemap
 * — разные, поэтому здесь два резолвера, а не один. `search_catalog_products`
 * применяет тот же порядок для card-контекста прямо в SQL (сигнатура RPC
 * фиксирована и не может вернуть несколько кандидатов), поэтому серверный и
 * клиентский путь card-обложки остаются идентичны по построению.
 */
export interface ProductImageVariantSource {
  url: string;
  thumbnail_url?: string | null;
  gallery_url?: string | null;
}

/** Карточки каталога и admin-превью: самый маленький готовый вариант. */
export function resolveCardImageUrl(image: ProductImageVariantSource): string {
  return image.thumbnail_url ?? image.gallery_url ?? image.url;
}

/** Галерея товара, zoom, homepage-панель, OpenGraph, sitemap: крупный
 * вариант, thumbnail здесь никогда не подходит по размеру. */
export function resolveGalleryImageUrl(image: ProductImageVariantSource): string {
  return image.gallery_url ?? image.url;
}

/**
 * Master гарантированно не удаляется (см. план: "Оригиналы хранятся
 * постоянно"), поэтому он единственный безопасный сетевой fallback, если
 * выбранный вариант окажется битым или ещё не догружен объектом в Storage
 * при заполненной колонке. Возвращает undefined, когда resolved уже и есть
 * master — тогда повторная попытка тем же URL ничего не даст.
 */
export function resolveImageFallbackUrl(image: ProductImageVariantSource, resolved: string): string | undefined {
  return resolved !== image.url ? image.url : undefined;
}
