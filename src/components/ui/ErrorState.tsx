"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

interface ErrorStateProps {
  title?: string;
  description?: string;
  retry?: () => void;
  homeHref?: string;
}

export function ErrorState({
  title = "Не удалось загрузить данные",
  description = "Проверьте соединение и попробуйте ещё раз.",
  retry,
  homeHref = "/",
}: ErrorStateProps) {
  return (
    <div className="mx-auto flex min-h-[45vh] max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
      <AlertTriangle className="h-10 w-10 text-warning" aria-hidden="true" />
      <h1 className="mt-4 text-2xl font-semibold text-foreground">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {retry && (
          <button
            type="button"
            onClick={retry}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            Повторить
          </button>
        )}
        <Link
          href={homeHref}
          className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          На главную
        </Link>
      </div>
    </div>
  );
}
