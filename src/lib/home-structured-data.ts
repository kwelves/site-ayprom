import { getSiteUrl } from "@/lib/site-url";
import { HOME_SEO_DESCRIPTION } from "@/lib/home-seo";

const SAME_AS = [
  "https://instagram.com/ayprom.kg",
  "https://tiktok.com/@ayprom.kg",
  "https://www.threads.com/@ayprom.kg",
  "https://2gis.kg/bishkek/firm/70000001102769110",
  "https://yandex.com/maps/org/ayprom/169874849937/",
];

// Как компанию набирают в поиске: кириллицей, латиницей и вперемешку.
// Латинское «Ayprom Gidravlika» встречается на сайте только внутри домена,
// поэтому без этой строки связка «ayprom gidravlika» ниоткуда не считывается.
// Один список на оба узла графа, чтобы они не разъехались.
const ALTERNATE_NAMES = ["Айпром", "Ayprom Gidravlika", "AYPROM Гидравлика", "Айпром Гидравлика"];

// Воскресенье не указано намеренно: в schema.org закрытый день — это просто
// отсутствие интервала, а не запись с нулевой длительностью.
const OPENING_HOURS = [
  {
    "@type": "OpeningHoursSpecification",
    dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    opens: "09:00",
    closes: "18:00",
  },
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
        // Домен — имя сайта, а не название компании, поэтому он только здесь.
        alternateName: [...ALTERNATE_NAMES, "ayprom-gidravlika.kg"],
        description: HOME_SEO_DESCRIPTION,
        publisher: { "@id": organizationId },
        inLanguage: "ru-KG",
      },
      {
        "@type": "AutoPartsStore",
        "@id": organizationId,
        url: siteUrl,
        name: "AYPROM",
        alternateName: ALTERNATE_NAMES,
        description: HOME_SEO_DESCRIPTION,
        logo: {
          "@type": "ImageObject",
          url: `${siteUrl}/brand/ayprom-icon-square.png`,
          width: 512,
          height: 512,
        },
        telephone: "+996500461155",
        contactPoint: {
          "@type": "ContactPoint",
          telephone: "+996500461155",
          contactType: "sales",
          availableLanguage: ["ru", "ky"],
        },
        address: {
          "@type": "PostalAddress",
          addressCountry: "KG",
          addressLocality: "Бишкек",
          streetAddress: "пр. Дэн Сяопина, 457/1",
        },
        areaServed: ["Кыргызстан", "Страны СНГ"],
        openingHoursSpecification: OPENING_HOURS,
        hasMap: "https://go.2gis.com/NEFoK",
        sameAs: SAME_AS,
      },
    ],
  };
}
