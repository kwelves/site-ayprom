"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/admin/products", label: "Товары" },
  { href: "/admin/brands", label: "Бренды" },
  { href: "/admin/vehicle-types", label: "Типы техники" },
  { href: "/admin/categories", label: "Категории" },
];

// A client component just for the nav links (rather than the whole layout)
// so the surrounding chrome — header bar, logout form — stays a plain
// server-rendered shell; usePathname() is only needed here, to know which
// section the admin is currently in.
export function AdminNav() {
  const pathname = usePathname();

  return (
    <>
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "transition-colors hover:text-primary",
              active ? "font-semibold text-primary" : "text-slate-600"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
