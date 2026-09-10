import type { Metadata } from "next";
import { OG_IMAGE } from "@/lib/og-image";

export const HOME_SEO_TITLE = "Гидравлические запчасти для спецтехники";
export const HOME_SEO_FULL_TITLE = `${HOME_SEO_TITLE} — AYPROM`;
// Title и Hero описывают одно предложение; география указана в контактах.
// Отдельная строка сохраняет оформление бренда в видимом заголовке.
export const HOME_HERO_TITLE = "AYPROM - гидравлические запчасти для спецтехники";
export const HOME_SEO_DESCRIPTION =
  "AYPROM: гидравлические запчасти для тягачей, самосвалов и спецтехники. Подбор по модели техники, КПП и артикулу. Доставка по Кыргызстану и в страны СНГ.";

export const HOME_METADATA = {
  title: { absolute: HOME_SEO_FULL_TITLE },
  description: HOME_SEO_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "ru_KG",
    siteName: "AYPROM",
    title: HOME_SEO_FULL_TITLE,
    description: HOME_SEO_DESCRIPTION,
    url: "/",
    images: [{ url: OG_IMAGE.url, width: OG_IMAGE.width, height: OG_IMAGE.height, alt: OG_IMAGE.alt }],
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_SEO_FULL_TITLE,
    description: HOME_SEO_DESCRIPTION,
    images: [OG_IMAGE.url],
  },
} satisfies Metadata;
