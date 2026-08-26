import type { Metadata } from "next";
import type { Product } from "@/types/catalog";

/** Обрезает описание по границе слова: Google показывает ~150-160 символов,
 * более длинный текст всё равно усекается многоточием на его стороне. */
const META_DESCRIPTION_LIMIT = 160;

function clamp(text: string, limit = META_DESCRIPTION_LIMIT): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  const cut = normalized.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:—-]+$/, "")}…`;
}

/** Большинство товаров заведены без описания, поэтому пустая meta-description
 * — это не редкий край, а поведение по умолчанию. Google в таком случае
 * составляет сниппет сам из случайного места страницы, что для карточки без
 * текста означает почти пустой сниппет. Детерминированный запасной вариант
 * даёт каждой странице уникальное осмысленное описание с названием товара,
 * артикулом и городом, пока реальные описания не заполнены в админке. */
function fallbackDescription(product: Product): string {
  const article = product.article ? ` Артикул: ${product.article}.` : "";
  return clamp(
    `${product.name} — купить в Бишкеке.${article} AYPROM: гидрооборудование и запчасти для грузовой и специальной техники, доставка по Кыргызстану и СНГ.`,
  );
}

/** Единый источник метаданных товара для всех маршрутов, ведущих на карточку
 * (прямой, брендовый и подкатегорийный). Раньше каждый маршрут собирал их
 * сам и ни один не читал SEO-поля из админки, из-за чего заполненные там
 * meta_title/meta_description не доходили до публичной страницы. */
export function buildProductMetadata(product: Product, canonical: string): Metadata {
  const title = product.metaTitle?.trim() || product.name;
  const description =
    product.metaDescription?.trim() ||
    product.description?.trim() ||
    product.shortDescription?.trim() ||
    fallbackDescription(product);
  const clampedDescription = clamp(description);
  const image = product.images[0]?.url;

  return {
    title,
    description: clampedDescription,
    alternates: { canonical },
    openGraph: {
      type: "website",
      title,
      description: clampedDescription,
      url: canonical,
      images: image ? [{ url: image, alt: product.name }] : undefined,
    },
  };
}

/** Метаданные ненайденного товара: страница отвечает 404, но метаданные
 * вычисляются до этого, поэтому её нужно явно закрыть от индексации. */
export const MISSING_PRODUCT_METADATA: Metadata = {
  title: "Товар",
  robots: { index: false },
};
