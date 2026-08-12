import Link from "next/link";
import { SearchX } from "lucide-react";

export default function PublicNotFound() {
  return (
    <div className="mx-auto flex min-h-[55vh] max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
      <SearchX className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <h1 className="mt-4 text-3xl font-semibold text-foreground">Страница не найдена</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Возможно, ссылка устарела или товар был перемещён. Вернитесь в каталог и попробуйте поиск.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          href="/catalog"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          Открыть каталог
        </Link>
        <Link
          href="/"
          className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          На главную
        </Link>
      </div>
    </div>
  );
}
