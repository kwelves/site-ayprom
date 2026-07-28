"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Menu, Search, X } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { NavDropdown } from "@/components/layout/NavDropdown";
import { ProductSearchForm } from "@/components/catalog/ProductSearchForm";
import { buildMainNav, type NavItem } from "@/lib/navigation";
import { useScroll } from "@/lib/use-scroll";
import { useHashNavClick } from "@/lib/use-hash-nav-click";
import { cn } from "@/lib/utils";
import type { Category, VehicleType } from "@/types/catalog";

export function Header({ categories, vehicleTypes }: { categories: Category[]; vehicleTypes: VehicleType[] }) {
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const scrolled = useScroll(10);
  const pathname = usePathname();
  const handleHashClick = useHashNavClick();
  const mainNav = buildMainNav(categories, vehicleTypes);

  // On the homepage the header floats transparently over the fixed hero video
  // until scroll. The hero's short top gradient supplies contrast; deriving
  // this during render keeps white navigation in the first server-rendered frame.
  const overPhoto = pathname === "/" && !scrolled && !open;

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full border-b border-transparent transition-[background-color,backdrop-filter,border-color] duration-300",
        overPhoto ? "bg-transparent" : pathname === "/" ? undefined : "bg-muted",
        scrolled && "border-border bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60",
        !scrolled && open && "bg-background"
      )}
    >
      <Container className="flex h-16 items-center justify-between">
        <Link
          href="/"
          className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          onClick={(event) => {
            handleHashClick("/", event);
            setOpen(false);
          }}
        >
          <Image
            src="/brand/ayprom-logo.svg"
            alt="AYPROM"
            width={378}
            height={90}
            className="h-9 w-auto object-contain"
            preload
            unoptimized
          />
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {mainNav.map((item) =>
            item.dropdown ? (
              <NavDropdown
                key={item.label}
                label={item.label}
                href={item.href}
                items={item.dropdown}
                light={overPhoto}
              />
            ) : (
              <Link
                key={item.label}
                href={item.href}
                onClick={(event) => handleHashClick(item.href, event)}
                className={cn(
                  "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  overPhoto
                    ? "text-white hover:bg-white/10"
                    : "text-slate-700 hover:bg-accent hover:text-accent-foreground"
                )}
              >
                {item.label}
              </Link>
            )
          )}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <button
            type="button"
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors",
              overPhoto ? "text-white hover:bg-white/10" : "text-slate-700 hover:bg-accent"
            )}
            onClick={() => {
              setOpen(false);
              setSearchOpen((value) => !value);
            }}
            aria-label={searchOpen ? "Закрыть поиск" : "Открыть поиск"}
            aria-expanded={searchOpen}
            aria-controls="header-search"
          >
            {searchOpen ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
          </button>
          <Button href="/catalog" size="sm">
            Все товары
          </Button>
        </div>

        <button
          type="button"
          className={cn(
            "inline-flex h-11 w-11 items-center justify-center rounded-md transition-colors md:hidden",
            overPhoto ? "text-white" : "text-slate-700"
          )}
          onClick={() => {
            setSearchOpen(false);
            setOpen((value) => !value);
          }}
          aria-label="Открыть меню"
          aria-expanded={open}
        >
          <motion.span
            key={open ? "close" : "open"}
            initial={{ rotate: -90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="flex"
          >
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </motion.span>
        </button>
      </Container>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden border-t border-border bg-card md:hidden"
          >
            <Container className="flex flex-col gap-1 py-4">
              <ProductSearchForm action="/catalog" placeholder="Например: гидроцилиндр HOWO" />
              {mainNav.map((item) => (
                <MobileNavItem
                  key={item.label}
                  item={item}
                  onNavigate={() => setOpen(false)}
                  handleHashClick={handleHashClick}
                />
              ))}
              <Button href="/catalog" className="mt-2 w-full" onClick={() => setOpen(false)}>
                Все товары
              </Button>
            </Container>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {searchOpen && (
          <motion.div
            id="header-search"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="hidden overflow-hidden border-t border-border bg-card md:block"
          >
            <Container className="py-4">
              <ProductSearchForm action="/catalog" placeholder="Например: гидроцилиндр HOWO" />
            </Container>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

function MobileNavItem({
  item,
  onNavigate,
  handleHashClick,
}: {
  item: NavItem;
  onNavigate: () => void;
  handleHashClick: (href: string, event: React.MouseEvent) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!item.dropdown) {
    return (
      <Link
        href={item.href}
        onClick={(event) => {
          handleHashClick(item.href, event);
          onNavigate();
        }}
        className="rounded-md flex min-h-11 items-center px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-muted hover:text-primary"
      >
        {item.label}
      </Link>
    );
  }

  return (
    <div>
      <div className="flex items-center">
        <Link
          href={item.href}
          onClick={(event) => {
            handleHashClick(item.href, event);
            onNavigate();
          }}
          className="flex-1 rounded-md flex min-h-11 items-center px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-muted hover:text-primary"
        >
          {item.label}
        </Link>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-primary"
          aria-expanded={expanded}
          aria-label={`Показать подраздел «${item.label}»`}
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", expanded && "rotate-180")} />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden pl-3"
          >
            <div className="grid gap-1 py-1">
              {item.dropdown.map((sub) => {
                const Icon = sub.icon;
                return (
                  <Link
                    key={sub.href}
                    href={sub.href}
                    onClick={onNavigate}
                    className="flex items-start gap-3 rounded-lg p-2 hover:bg-muted"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="flex flex-col">
                      <span className="text-sm font-medium text-card-foreground">{sub.label}</span>
                      <span className="text-xs text-muted-foreground">{sub.description}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
