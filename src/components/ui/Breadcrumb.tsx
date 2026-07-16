"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ChevronRight } from "lucide-react";
import { categories } from "@/data/categories";
import { subcategoriesByCategory } from "@/data/subcategories";
import { brands } from "@/data/brands";
import { brandsByCategory } from "@/data/category-brands";
import { products } from "@/data/products";

interface Crumb {
  label: string;
  href?: string;
}

// Reads the current path rather than taking props, so a single instance in
// the shared category/brand layouts covers every nested route (category,
// subcategory, brand-in-category, and their product pages) without each
// page having to compute and pass its own trail down.
function resolveCrumbs(pathname: string): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "catalog") return [];

  const crumbs: Crumb[] = [];

  if (segments[1] === "category" && segments[2]) {
    const categorySlug = segments[2];
    const category = categories.find((item) => item.slug === categorySlug);
    if (!category) return crumbs;
    crumbs.push({ label: category.name, href: `/catalog/category/${categorySlug}` });

    if (segments[3] === "subcategory" && segments[4]) {
      const subSlug = segments[4];
      const subcategory = subcategoriesByCategory[categorySlug]?.find((item) => item.slug === subSlug);
      if (subcategory) {
        crumbs.push({
          label: subcategory.name,
          href: `/catalog/category/${categorySlug}/subcategory/${subSlug}`,
        });
        const product = segments[5] ? products.find((item) => item.slug === segments[5]) : undefined;
        if (product) crumbs.push({ label: product.name });
      }
    } else if (segments[3] === "brand" && segments[4]) {
      const brandSlug = segments[4];
      const brand = brandsByCategory[categorySlug]?.find((item) => item.slug === brandSlug);
      if (brand) {
        crumbs.push({ label: brand.name, href: `/catalog/category/${categorySlug}/brand/${brandSlug}` });
        const product = segments[5] ? products.find((item) => item.slug === segments[5]) : undefined;
        if (product) crumbs.push({ label: product.name });
      }
    }
  } else if (segments[1] === "brand" && segments[2]) {
    const brand = brands.find((item) => item.slug === segments[2]);
    if (brand) crumbs.push({ label: brand.name });
  }

  return crumbs;
}

export function Breadcrumb() {
  const pathname = usePathname();
  const crumbs = resolveCrumbs(pathname);

  if (crumbs.length === 0) return null;

  return (
    <nav aria-label="Хлебные крошки" className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
      <Link href="/" aria-label="Главная" className="text-slate-500 transition-colors hover:text-primary">
        <Home className="h-4 w-4" />
      </Link>
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={`${crumb.label}-${i}`} className="flex items-center gap-x-1.5">
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            {crumb.href && !isLast ? (
              <Link href={crumb.href} className="text-slate-500 transition-colors hover:text-primary">
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
