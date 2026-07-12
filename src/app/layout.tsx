import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { ScrollToHash } from "@/components/layout/ScrollToHash";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AYPROM — гидрооборудование и запчасти для спецтехники",
  description:
    "AYPROM: каталог гидрооборудования и запчастей для спецтехники и грузовой техники. Подбор по категории, марке техники, названию или артикулу.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className={`${geistSans.variable} h-full scroll-smooth antialiased`}>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <ScrollToHash />
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
