import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { WhatsAppBadge } from "@/components/site/WhatsAppBadge";
import { ScrollToHash } from "@/components/layout/ScrollToHash";
import { ResetScrollOnNavigate } from "@/components/layout/ResetScrollOnNavigate";
import { getCategories } from "@/lib/queries/categories";
import { getBrands } from "@/lib/queries/brands";
import { StructuredData } from "@/components/seo/StructuredData";
import { MotionPreferences } from "@/components/motion/MotionPreferences";
import { HomeEntrySequence } from "@/components/home/HomeEntrySequence";
import { getSiteUrl } from "@/lib/site-url";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: "AYPROM — гидрооборудование и запчасти для спецтехники",
    template: "%s — AYPROM",
  },
  description:
    "AYPROM: каталог гидрооборудования и запчастей для спецтехники и грузовой техники. Подбор по категории, марке техники, названию или артикулу.",
  openGraph: {
    type: "website",
    locale: "ru_KG",
    siteName: "AYPROM",
    title: "AYPROM — гидрооборудование и запчасти для спецтехники",
    description:
      "Каталог гидрооборудования и запчастей для грузовой и специальной техники в Бишкеке.",
  },
  twitter: { card: "summary_large_image" },
};

export const revalidate = 60;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [categories, brands] = await Promise.all([getCategories(), getBrands()]);
  const supabaseOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;

  return (
    <html lang="ru" className={`${geistSans.variable} h-full antialiased`}>
      {/* Hero-видео на главной запрашивается с Supabase Storage сразу при
          заходе на сайт. Next не хоистит resource hints автоматически для
          media-запросов, поэтому DNS/TLS к этому origin иначе начинаются
          только в момент, когда браузер доходит до <video><source>, — этот
          preconnect убирает эту задержку с критического пути. Next хоистит
          любой <link>, отрисованный в дереве, в <head> сам. */}
      <link rel="preconnect" href={supabaseOrigin} crossOrigin="anonymous" />
      <link rel="dns-prefetch" href={supabaseOrigin} />
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <MotionPreferences>
        <HomeEntrySequence>
        <StructuredData
          data={{
            "@context": "https://schema.org",
            "@type": "Organization",
            name: "AYPROM",
            url: getSiteUrl(),
            email: "info@ayprom.kg",
            address: {
              "@type": "PostalAddress",
              addressCountry: "KG",
              addressLocality: "Бишкек",
              streetAddress: "пр. Дэн Сяопина, 457/1",
            },
            sameAs: ["https://instagram.com/ayprom.kg", "https://tiktok.com/@ayprom.kg"],
          }}
        />
        <ScrollToHash />
        <ResetScrollOnNavigate />
        <Header categories={categories} brands={brands} />
        <main id="main-content" className="flex-1" tabIndex={-1}>{children}</main>
        <Footer categories={categories} brands={brands} />
        <WhatsAppBadge />
        </HomeEntrySequence>
        </MotionPreferences>
        <SpeedInsights />
      </body>
    </html>
  );
}
