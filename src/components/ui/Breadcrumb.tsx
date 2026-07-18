"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface Crumb {
  label: string;
  href?: string;
}

// Reads the current path rather than taking props, so a single instance in
// the shared category/brand layouts covers every nested route (category,
// subcategory, brand-in-category, and their product pages) without each
// page having to compute and pass its own trail down. Runs client-side
// (RLS already allows anonymous reads) since it's the one place that needs
// to react to path changes rather than fetch once per server render.
async function resolveCrumbs(pathname: string): Promise<Crumb[]> {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "catalog") return [];

  const supabase = createClient();
  const crumbs: Crumb[] = [];

  if (segments[1] === "category" && segments[2]) {
    const categorySlug = segments[2];
    const { data: category } = await supabase
      .from("categories")
      .select("name")
      .eq("slug", categorySlug)
      .maybeSingle();
    if (!category) return crumbs;
    crumbs.push({ label: category.name, href: `/catalog/category/${categorySlug}` });

    if (segments[3] === "subcategory" && segments[4]) {
      const subSlug = segments[4];
      const { data: subcategory } = await supabase
        .from("subcategories")
        .select("name")
        .eq("category_slug", categorySlug)
        .eq("slug", subSlug)
        .maybeSingle();
      if (subcategory) {
        crumbs.push({
          label: subcategory.name,
          href: `/catalog/category/${categorySlug}/subcategory/${subSlug}`,
        });
        if (segments[5]) {
          const { data: product } = await supabase
            .from("products")
            .select("name")
            .eq("slug", segments[5])
            .maybeSingle();
          if (product) crumbs.push({ label: product.name });
        }
      }
    } else if (segments[3] === "brand" && segments[4]) {
      const brandSlug = segments[4];
      const { data: categoryBrand } = await supabase
        .from("category_brands")
        .select("brands(name)")
        .eq("category_slug", categorySlug)
        .eq("brand_slug", brandSlug)
        .maybeSingle<{ brands: { name: string } }>();
      if (categoryBrand) {
        crumbs.push({
          label: categoryBrand.brands.name,
          href: `/catalog/category/${categorySlug}/brand/${brandSlug}`,
        });
        if (segments[5]) {
          const { data: product } = await supabase
            .from("products")
            .select("name")
            .eq("slug", segments[5])
            .maybeSingle();
          if (product) crumbs.push({ label: product.name });
        }
      }
    }
  } else if (segments[1] === "brand" && segments[2]) {
    const { data: brand } = await supabase.from("brands").select("name").eq("slug", segments[2]).maybeSingle();
    if (brand) crumbs.push({ label: brand.name });
  }

  return crumbs;
}

export function Breadcrumb() {
  const pathname = usePathname();
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);

  useEffect(() => {
    let cancelled = false;
    resolveCrumbs(pathname).then((result) => {
      if (!cancelled) setCrumbs(result);
    });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (crumbs.length === 0) return null;

  return (
    <nav aria-label="Хлебные крошки" className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
      <Link href="/" aria-label="Главная" className="text-slate-500 transition-colors hover:text-primary">
        <Home className="h-5 w-5" />
      </Link>
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={`${crumb.label}-${i}`} className="flex items-center gap-x-1.5">
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />
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
