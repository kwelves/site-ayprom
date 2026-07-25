import { getSiteUrl } from "@/lib/site-url";
import type { Product } from "@/types/catalog";

function absoluteUrl(value: string): string {
  return value.startsWith("http://") || value.startsWith("https://") ? value : `${getSiteUrl()}${value}`;
}

export function buildProductStructuredData(product: Product, canonicalPath: string) {
  const canonicalUrl = `${getSiteUrl()}${canonicalPath}`;

  return [
    {
      "@context": "https://schema.org",
      "@type": "Product",
      name: product.name,
      description: product.description || product.shortDescription,
      sku: product.article,
      image: product.images.map((image) => absoluteUrl(image.url)),
      url: canonicalUrl,
      category: product.category,
    },
    {
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
    },
  ];
}
