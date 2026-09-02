import { getSiteUrl } from "@/lib/site-url";

export interface StructuredBreadcrumbItem {
  label: string;
  href?: string;
}

function absoluteUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const siteUrl = getSiteUrl();
  return path === "/" ? siteUrl : `${siteUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export function buildBreadcrumbStructuredData(
  items: StructuredBreadcrumbItem[],
  canonicalPath: string,
): Record<string, unknown> {
  const breadcrumbs: StructuredBreadcrumbItem[] = [{ label: "Главная", href: "/" }, ...items];

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbs.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.label,
      item: absoluteUrl(item.href ?? canonicalPath),
    })),
  };
}
