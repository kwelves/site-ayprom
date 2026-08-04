"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Menu, X } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { NavDropdown } from "@/components/layout/NavDropdown";
import { buildMainNav, type NavItem } from "@/lib/navigation";
import { useScroll } from "@/lib/use-scroll";
import { useHashNavClick } from "@/lib/use-hash-nav-click";
import { cn } from "@/lib/utils";
import type { Brand, Category } from "@/types/catalog";

export function Header({ categories, brands }: { categories: Category[]; brands: Brand[] }) {
  const [open, setOpen] = useState(false);
  const scrolled = useScroll(10);
  const pathname = usePathname();
  const handleHashClick = useHashNavClick();
  const mainNav = buildMainNav(categories, brands);

  // On the homepage the header floats transparently over the fixed hero video
  // until scroll. The hero's short top gradient supplies contrast; deriving
  // this during render keeps white navigation in the first server-rendered frame.
  const overPhoto = pathname === "/" && !scrolled && !open;

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full border-b border-transparent transition-[background-color,backdrop-filter,border-color] duration-200",
        overPhoto ? "bg-transparent" : pathname === "/" ? undefined : "bg-muted",
        scrolled && "border-border bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60",
        !scrolled && open && "bg-background"
      )}
    >
      <Container className="flex h-16 items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          onClick={(event) => {
            handleHashClick("/", event);
            setOpen(false);
          }}
        >
          <motion.span
            className="inline-flex origin-top-right"
            animate={{ scale: overPhoto ? 1.6 : 1 }}
            transition={{ duration: overPhoto ? 0.15 : 0.2, ease: "easeOut" }}
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
          </motion.span>
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
                fixedSingleColumn={item.label === "Бренды"}
                scrollable={item.label === "Бренды"}
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

        <div className="hidden md:block">
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
          onClick={() => setOpen((value) => !value)}
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
              {item.dropdown.map((sub) => (
                <Link
                  key={sub.href}
                  href={sub.href}
                  onClick={onNavigate}
                  className="flex items-start gap-3 rounded-lg p-2 hover:bg-muted"
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg",
                      sub.logo ? "border border-border bg-white" : "bg-accent text-accent-foreground"
                    )}
                  >
                    {sub.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element -- local brand SVGs; next/image blocks them without dangerouslyAllowSVG
                      <img src={sub.logo} alt="" className="h-full w-full object-contain p-1" />
                    ) : sub.icon ? (
                      <sub.icon className="h-4 w-4" />
                    ) : null}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-card-foreground">{sub.label}</span>
                    <span className="text-xs text-muted-foreground">{sub.description}</span>
                  </span>
                </Link>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
