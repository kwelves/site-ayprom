import type { Metadata } from "next";

export const HOME_SEO_TITLE = "Гидравлика и запчасти для спецтехники в Бишкеке";
export const HOME_SEO_FULL_TITLE = `${HOME_SEO_TITLE} — AYPROM`;
export const HOME_HERO_TITLE = "AYPROM - гидравлические запчасти для спецтехники";
export const HOME_SEO_DESCRIPTION =
  "Гидравлика и запчасти для тягачей, самосвалов и спецтехники. Подберём по марке и артикулу. Гарантия на комплекты 12 месяцев, доставка по Кыргызстану и СНГ.";

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
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_SEO_FULL_TITLE,
    description: HOME_SEO_DESCRIPTION,
  },
} satisfies Metadata;
