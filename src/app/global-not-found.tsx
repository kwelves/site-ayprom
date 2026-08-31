import type { Metadata } from "next";
import Link from "next/link";
import localFont from "next/font/local";
import { SearchX } from "lucide-react";
import "./globals.css";

// global-not-found обходится без обоих root layout, поэтому сам объявляет
// локальные шрифты и не зависит от сети. Это также не возвращает в build
// дополнительную загрузку Google Fonts.
// `preload: false` обязателен и повторяет решение `(site)/layout.tsx`: Next
// собирает preload-теги этого файла в общий head, поэтому с preload по
// умолчанию каждая страница сайта тянула отдельные `.p.`-копии шрифтов 404 и
// не использовала их. `display: swap` с fallback сохраняет читаемость 404.
const razerF5 = localFont({
  src: [
    {
      path: "./fonts/razer-f5/razer-f5-semibold.ttf",
      weight: "600",
      style: "normal",
    },
    {
      path: "./fonts/razer-f5/razer-f5-bold.ttf",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-razer-f5",
  display: "swap",
  preload: false,
  fallback: ["Arial", "sans-serif"],
});

const rubik = localFont({
  src: "./fonts/rubik/rubik-variable.ttf",
  variable: "--font-rubik",
  weight: "300 900",
  style: "normal",
  display: "swap",
  preload: false,
  fallback: ["Arial", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Страница не найдена — AYPROM",
  description: "Запрошенная страница не существует. Перейдите на главную страницу или откройте каталог AYPROM.",
};

export default function GlobalNotFound() {
  return (
    <html lang="ru" className={`${razerF5.variable} ${rubik.variable} h-full antialiased`}>
      <body data-site-root data-global-not-found className="min-h-full bg-background text-foreground">
        <main
          id="main-content"
          className="relative isolate flex min-h-screen items-center justify-center overflow-hidden px-6 py-16"
        >
          <div className="absolute inset-x-0 top-0 h-1 bg-primary" aria-hidden="true" />
          <section className="w-full max-w-xl text-center" aria-labelledby="global-not-found-title">
            <Link
              href="/"
              className="inline-flex rounded-md text-sm font-bold tracking-[0.18em] text-primary transition-colors hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              AYPROM
            </Link>
            <div className="mx-auto mt-8 flex size-16 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
              <SearchX className="size-8 text-primary" aria-hidden="true" />
            </div>
            <p className="mt-6 text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Ошибка 404
            </p>
            <h1 id="global-not-found-title" className="mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
              Страница не найдена
            </h1>
            <p className="mx-auto mt-4 max-w-md text-pretty text-base leading-relaxed text-muted-foreground">
              Возможно, адрес изменился или в ссылке есть ошибка. Вернитесь на главную страницу либо продолжите поиск в каталоге.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link
                href="/catalog"
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-[background-color,scale] hover:bg-primary-hover active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                Открыть каталог
              </Link>
              <Link
                href="/"
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-card px-5 py-2.5 text-sm font-semibold text-foreground transition-[background-color,scale] hover:bg-accent active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                На главную
              </Link>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
