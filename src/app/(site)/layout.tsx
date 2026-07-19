import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { ScrollToHash } from "@/components/layout/ScrollToHash";
import { ResetScrollOnNavigate } from "@/components/layout/ResetScrollOnNavigate";
import { getCategories } from "@/lib/queries/categories";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AYPROM — гидрооборудование и запчасти для спецтехники",
  description:
    "AYPROM: каталог гидрооборудования и запчастей для спецтехники и грузовой техники. Подбор по категории, марке техники, названию или артикулу.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const categories = await getCategories();

  return (
    <html lang="ru" className={`${geistSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <ScrollToHash />
        <ResetScrollOnNavigate />
        <Header categories={categories} />
        <main className="flex-1">{children}</main>
        <Footer categories={categories} />
        <SpeedInsights />
      </body>
    </html>
  );
}
