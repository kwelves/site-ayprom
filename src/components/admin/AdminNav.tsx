"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Package, Truck, Tag, Wrench, LayoutGrid, Upload, ScrollText, KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";

export const NAV_ITEMS = [
  { href: "/admin/products", label: "Товары", icon: Package },
  { href: "/admin/vehicle-showcase", label: "Спецтехника", icon: Truck },
  { href: "/admin/brands", label: "Бренды", icon: Tag },
  { href: "/admin/vehicle-types", label: "Типы техники", icon: Wrench },
  { href: "/admin/categories", label: "Категории", icon: LayoutGrid },
  { href: "/admin/import", label: "Импорт", icon: Upload },
  { href: "/admin/audit", label: "Журнал", icon: ScrollText },
  { href: "/admin/security", label: "Пароль", icon: KeyRound },
] as const;

function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

interface AdminNavProps {
  /** "sidebar" — vertical list with icons, full label, for the lg+ sidebar.
   * "inline" — the original compact horizontal text-only list, kept for any
   * context that still wants it. */
  variant?: "sidebar" | "inline";
  onNavigate?: () => void;
}

// A client component just for the nav links (rather than the whole layout)
// so the surrounding chrome — header bar, logout form — stays a plain
// server-rendered shell; usePathname() is only needed here, to know which
// section the admin is currently in.
export function AdminNav({ variant = "inline", onNavigate }: AdminNavProps) {
  const pathname = usePathname();
  const router = useRouter();

  function warmRoute(href: string) {
    if (!isNavItemActive(pathname, href)) router.prefetch(href);
  }

  if (variant === "sidebar") {
    return (
      <>
        {NAV_ITEMS.map((item) => {
          const active = isNavItemActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
              onPointerEnter={() => warmRoute(item.href)}
              onFocus={() => warmRoute(item.href)}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-accent text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-card-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </>
    );
  }

  return (
    <>
      {NAV_ITEMS.map((item) => {
        const active = isNavItemActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            onPointerEnter={() => warmRoute(item.href)}
            onFocus={() => warmRoute(item.href)}
            className={cn(
              "transition-colors hover:text-primary",
              active ? "font-semibold text-primary" : "text-muted-foreground"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
