"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { activeNavItem } from "@/components/admin/AdminNav";
import { AdminMobileNav } from "@/components/admin/AdminMobileNav";
import { AdminPublicationStatus } from "@/components/admin/AdminPublicationStatus";
import { AdminThemeToggle } from "@/components/admin/AdminThemeToggle";
import { AdminMark } from "@/components/admin/ui/AdminMark";
import { cn } from "@/lib/utils";

const PRODUCTS_PATH = "/admin/products";

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

// The 60px glass bar on top of every admin page (design system v2, shell): where you are, product search, the
// moon. Ctrl+K / ⌘K or "/" puts the cursor in product search at once, without animation (a keyboard action is
// repeated many times a day). On the products list the page's own search box takes the shortcut.
export function AdminTopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const section = activeNavItem(pathname);
  const onProducts = pathname === PRODUCTS_PATH;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const shortcut = (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) || (event.key === "/" && !isTyping(event.target));
      if (!shortcut) return;
      const target = document.querySelector<HTMLInputElement>("[data-admin-search]") ?? inputRef.current;
      if (!target) return;
      event.preventDefault();
      target.focus();
      target.select();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const q = query.trim();
    router.push(q ? `${PRODUCTS_PATH}?q=${encodeURIComponent(q)}` : PRODUCTS_PATH);
    setQuery("");
    inputRef.current?.blur();
  }

  return (
    <header className="glass-float sticky top-3 z-30 flex h-[60px] items-center gap-3 rounded-[18px] px-3 sm:px-4">
      <div className="lg:hidden">
        <AdminMobileNav />
      </div>
      <Link href={PRODUCTS_PATH} aria-label="AYPROM · Админка, к товарам" className="rounded-[10px] lg:hidden">
        <AdminMark variant="icon" size="sm" />
      </Link>

      <p className="min-w-0 truncate text-sm">
        <span className="hidden text-muted-foreground sm:inline">Админка</span>
        {section && (
          <>
            <span className="hidden px-1.5 text-faint-foreground sm:inline" aria-hidden="true">/</span>
            <span className="font-semibold text-foreground">{section.label}</span>
          </>
        )}
      </p>

      <div className="ml-auto flex items-center gap-1.5">
        {!onProducts && (
          <form role="search" onSubmit={submit} className="relative hidden md:block">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Найти товар по названию или артикулу"
              aria-label="Найти товар"
              className={cn(
                "field-surface h-9.5 w-[min(360px,32vw)] rounded-[10px] border border-input pr-14 pl-9 text-sm text-foreground transition-[border-color,box-shadow] duration-fast ease-ui hover:border-border-interactive focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20",
              )}
            />
            <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded-[6px] bg-surface-strong px-1.5 py-0.5 font-sans text-[11px] font-medium text-muted-foreground">
              Ctrl K
            </kbd>
          </form>
        )}
        <span className="lg:hidden">
          <AdminPublicationStatus compact />
        </span>
        <AdminThemeToggle />
      </div>
    </header>
  );
}
