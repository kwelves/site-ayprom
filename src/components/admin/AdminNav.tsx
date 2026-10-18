"use client";

import { useId } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { Package, Truck, Tag, Wrench, LayoutGrid, Upload, ScrollText, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

// Sections grouped the way the work goes: the catalog itself, what the public home page shows, data moved in
// bulk and the record of changes. Password, theme and sign-out live in the settings menu below the navigation.
export const NAV_GROUPS: readonly { label: string; items: readonly NavItem[] }[] = [
  {
    label: "Каталог",
    items: [
      { href: "/admin/products", label: "Товары", icon: Package },
      { href: "/admin/categories", label: "Категории", icon: LayoutGrid },
      { href: "/admin/brands", label: "Бренды", icon: Tag },
      { href: "/admin/vehicle-types", label: "Типы техники", icon: Wrench },
    ],
  },
  {
    label: "Сайт",
    items: [{ href: "/admin/vehicle-showcase", label: "Спецтехника", icon: Truck }],
  },
  {
    label: "Данные",
    items: [
      { href: "/admin/import", label: "Импорт", icon: Upload },
      { href: "/admin/audit", label: "Журнал", icon: ScrollText },
    ],
  },
];

export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function activeNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => isNavItemActive(pathname, item.href));
}

interface AdminNavProps {
  /** "sidebar" — grouped vertical list with icons (sidebar and phone drawer).
   * "inline" — compact horizontal text-only list, kept for any context that still wants it. */
  variant?: "sidebar" | "inline";
  /** Sidebar folded to icons (72px). Labels stay for screen readers and as tooltips. */
  collapsed?: boolean;
  onNavigate?: () => void;
}

// A client component just for the nav links (rather than the whole layout)
// so the surrounding chrome stays a plain shell; usePathname() is only needed
// here, to know which section the admin is currently in.
export function AdminNav({ variant = "inline", collapsed = false, onNavigate }: AdminNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const groupId = useId();
  const reduceMotion = useReducedMotion();

  function warmRoute(href: string) {
    if (!isNavItemActive(pathname, href)) router.prefetch(href);
  }

  if (variant === "sidebar") {
    return (
      <LayoutGroup id={groupId}>
        {NAV_GROUPS.map((group, groupIndex) => (
          // Folded, the group names are dropped without any divider in their place; every item becomes a 40px square
          // centred on the sidebar's axis, the same axis as the logo, the status dot and the settings button.
          <div
            key={group.label}
            className={cn(
              groupIndex > 0 && !collapsed && "mt-3 [@media(max-height:700px)]:mt-1.5",
              groupIndex > 0 && collapsed && "mt-1.5",
            )}
          >
            {!collapsed && (
              <p className="mb-1 h-4 px-3 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase [@media(max-height:700px)]:sr-only">
                {group.label}
              </p>
            )}
            <div className={cn("flex flex-col gap-0.5", collapsed && "items-center")}>
              {group.items.map((item) => {
                const active = isNavItemActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    aria-label={collapsed ? item.label : undefined}
                    title={collapsed ? item.label : undefined}
                    onClick={onNavigate}
                    onPointerEnter={() => warmRoute(item.href)}
                    onFocus={() => warmRoute(item.href)}
                    className={cn(
                      "group/nav relative flex shrink-0 items-center rounded-[12px] text-sm font-medium transition-colors duration-fast ease-ui focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30",
                      collapsed ? "size-10 justify-center" : "h-9 gap-3 px-3",
                      active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="admin-nav-active"
                        aria-hidden="true"
                        className="glass-float absolute inset-0 rounded-[12px] [backdrop-filter:none]"
                        transition={reduceMotion ? { duration: 0.12 } : { type: "spring", duration: 0.4, bounce: 0.15 }}
                      />
                    )}
                    {!active && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-0 rounded-[12px] bg-accent opacity-0 transition-opacity duration-fast ease-ui group-hover/nav:opacity-100"
                      />
                    )}
                    <Icon
                      aria-hidden="true"
                      className="relative size-[18px] shrink-0 transition-[scale,translate] duration-base ease-spring-soft group-hover/nav:scale-[1.08]"
                    />
                    {!collapsed && (
                      <span className="relative truncate transition-[translate] duration-base ease-ui group-hover/nav:translate-x-px">
                        {item.label}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </LayoutGroup>
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
