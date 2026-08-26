import { getSiteUrl } from "@/lib/site-url";
import type { Product } from "@/types/catalog";

export function buildProductStructuredData(product: Product, canonicalPath: string) {
  const canonicalUrl = `${getSiteUrl()}${canonicalPath}`;

  // Product rich results require genuine offer, review, or rating data.
  // Until the catalog publishes it, expose only the valid page breadcrumb.
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Главная",
        item: getSiteUrl(),
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Каталог",
        item: `${getSiteUrl()}/catalog`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: product.name,
        item: canonicalUrl,
      },
    ],
  };
}
