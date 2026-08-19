import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

// For sections nested two or more levels deep (Категории → [Категория] →
// Подкатегории) where a single BackLink only shows the immediate parent —
// BackLink itself stays the right choice for a plain one-level-up page.
export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Хлебные крошки" className="flex flex-wrap items-center gap-1.5 text-sm">
      {items.map((item, index) => (
        <span key={index} className="flex items-center gap-1.5">
          {index > 0 && <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-faint-foreground" />}
          {item.href ? (
            <Link href={item.href} className="text-muted-foreground transition-colors hover:text-primary">
              {item.label}
            </Link>
          ) : (
            <span aria-current="page" className="font-medium text-card-foreground">
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
