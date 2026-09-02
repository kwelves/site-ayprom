import { afterEach, describe, expect, it } from "vitest";
import { buildBreadcrumbStructuredData } from "@/lib/breadcrumb-structured-data";

const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  if (originalSiteUrl === undefined) {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  } else {
    process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
  }
});

describe("breadcrumb structured data", () => {
  it("публикует полный абсолютный путь, совпадающий с видимыми крошками", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.ayprom-gidravlika.kg/";

    expect(
      buildBreadcrumbStructuredData(
        [
          { label: "Гидронасосы", href: "/catalog/category/hydraulic-pumps" },
          {
            label: "Шестерёнчатые насосы",
            href: "/catalog/category/hydraulic-pumps/subcategory/gear-pumps",
          },
          { label: "Насос НШ-100" },
        ],
        "/catalog/category/hydraulic-pumps/subcategory/gear-pumps/nasos-nsh-100",
      ),
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Главная",
          item: "https://www.ayprom-gidravlika.kg",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Гидронасосы",
          item: "https://www.ayprom-gidravlika.kg/catalog/category/hydraulic-pumps",
        },
        {
          "@type": "ListItem",
          position: 3,
          name: "Шестерёнчатые насосы",
          item: "https://www.ayprom-gidravlika.kg/catalog/category/hydraulic-pumps/subcategory/gear-pumps",
        },
        {
          "@type": "ListItem",
          position: 4,
          name: "Насос НШ-100",
          item: "https://www.ayprom-gidravlika.kg/catalog/category/hydraulic-pumps/subcategory/gear-pumps/nasos-nsh-100",
        },
      ],
    });
  });
});
