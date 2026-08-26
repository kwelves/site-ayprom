import { getSiteUrl } from "@/lib/site-url";
import { HOME_SEO_DESCRIPTION } from "@/lib/home-seo";

const SAME_AS = [
  "https://instagram.com/ayprom.kg",
  "https://tiktok.com/@ayprom.kg",
  "https://2gis.kg/bishkek/firm/70000001102769110",
  "https://yandex.com/maps/org/ayprom/169874849937/",
];

export function buildHomeStructuredData(): Record<string, unknown> {
  const siteUrl = getSiteUrl();
  const organizationId = `${siteUrl}/#organization`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${siteUrl}/#website`,
        url: siteUrl,
        name: "AYPROM",
        alternateName: ["AYPROM Гидравлика", "ayprom-gidravlika.kg"],
        description: HOME_SEO_DESCRIPTION,
        publisher: { "@id": organizationId },
        inLanguage: "ru-KG",
      },
      {
        "@type": "AutoPartsStore",
        "@id": organizationId,
        url: siteUrl,
        name: "AYPROM",
        alternateName: "AYPROM Гидравлика",
        description: HOME_SEO_DESCRIPTION,
        logo: {
          "@type": "ImageObject",
          url: `${siteUrl}/brand/ayprom-icon-square.png`,
          width: 512,
          height: 512,
        },
        email: "info@ayprom.kg",
        telephone: "+996500461155",
        address: {
          "@type": "PostalAddress",
          addressCountry: "KG",
          addressLocality: "Бишкек",
          streetAddress: "пр. Дэн Сяопина, 457/1",
        },
        areaServed: ["Кыргызстан", "Страны СНГ"],
        sameAs: SAME_AS,
      },
    ],
  };
}
