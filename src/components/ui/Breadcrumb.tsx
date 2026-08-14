import Link from "next/link";
import { Home, ChevronRight } from "lucide-react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Хлебные крошки" className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
      <Link href="/" aria-label="Главная" className="text-muted-foreground transition-colors duration-fast ease-ui hover:text-primary">
        <Home className="h-5 w-5" />
      </Link>
      {items.map((crumb, index) => {
        const isLast = index === items.length - 1;
        return (
          <span key={`${crumb.label}-${index}`} className="flex items-center gap-x-1.5">
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            {crumb.href && !isLast ? (
              <Link href={crumb.href} className="text-muted-foreground transition-colors duration-fast ease-ui hover:text-primary">
                {crumb.label}
              </Link>
            ) : (
              <span className="font-medium text-foreground">{crumb.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
