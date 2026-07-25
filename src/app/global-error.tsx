"use client";

import "./globals.css";

export default function GlobalError({ unstable_retry }: { unstable_retry: () => void }) {
  return (
    <html lang="ru">
      <body className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground">
        <main className="max-w-lg text-center">
          <h1 className="text-2xl font-semibold">Не удалось открыть страницу</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Произошла непредвиденная ошибка. Повторите попытку — сохранённые в базе данные не изменены.
          </p>
          <button
            type="button"
            onClick={unstable_retry}
            className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Повторить
          </button>
        </main>
      </body>
    </html>
  );
}
