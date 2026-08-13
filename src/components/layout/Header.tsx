"use client";

import { useEffect, useRef, useState } from "react";
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
  // Accordion: at most one mobile dropdown ("Каталог"/"Бренды") open at a
  // time, tracked by label here instead of locally in MobileNavItem so
  // opening one can collapse the other. Reset whenever the whole mobile
  // menu closes, so reopening it later never surfaces a dropdown that was
  // left expanded from a previous visit.
  const [expandedLabel, setExpandedLabel] = useState<string | null>(null);
  const scrolled = useScroll(10);
  const pathname = usePathname();
  const handleHashClick = useHashNavClick();
  const mainNav = buildMainNav(categories, brands);

  // Closes the whole mobile menu and, in the same breath, whatever
  // dropdown was expanded inside it — used everywhere the panel closes
  // instead of a bare `setOpen(false)`, so reopening it later never
  // surfaces a dropdown left expanded from a previous visit.
  const closeMenu = () => {
    setOpen(false);
    setExpandedLabel(null);
  };

  const panelRef = useRef<HTMLDivElement>(null);
  const toggleButtonRef = useRef<HTMLButtonElement>(null);

  // While the panel is open, treat two things as "dismiss": tapping
  // anywhere outside it (the site visible below, now that its height is
  // capped instead of unbounded) or scrolling that underlying page by
  // more than a few dozen px. Deliberately not a body-scroll-lock — a
  // little scroll is let through on purpose, it's just read as "done with
  // the menu" rather than left to silently keep scrolling a page the user
  // can no longer fully see under the panel. Uses the setState setters
  // directly (stable identities, no need for `closeMenu` in the deps
  // array) so this effect only re-subscribes when `open` actually changes.
  useEffect(() => {
    if (!open) return;

    const dismiss = () => {
      setOpen(false);
      setExpandedLabel(null);
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || toggleButtonRef.current?.contains(target)) return;
      dismiss();
    };

    const baselineScrollY = window.scrollY;
    const SCROLL_CLOSE_THRESHOLD_PX = 36;
    const handleScroll = () => {
      if (Math.abs(window.scrollY - baselineScrollY) >= SCROLL_CLOSE_THRESHOLD_PX) dismiss();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [open]);

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
            closeMenu();
          }}
        >
          {/* The enlarged-over-hero state is a CSS transition keyed off a data
              attribute, not a Framer `animate` prop: the class lands in the
              first server-rendered frame (Framer only applies its transform
              after mount, so the large logo never showed on a fresh load), and
              a CSS transform animates off the main thread.

              The scale is capped by how much room the logo actually has to
              grow into, not by one number picked at one window size. Origin is
              top-left below `lg`, so it grows rightwards into the gap before
              the navigation; from `lg` it is top-right and grows leftwards
              into the page gutter, which is only 32px wide until the viewport
              outgrows the 1280px container — hence the smaller 1.15 there
              (22.7px of growth, ~9px of breathing room left) and full 1.6
              again from the `wide` breakpoint, defined in globals.css as the
              first width whose gutter clears what the full scale needs. */}
          <span
            data-large={overPhoto || undefined}
            className={cn(
              "inline-flex origin-top-left transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] lg:origin-top-right",
              "scale-100 data-[large]:scale-[1.6] md:data-[large]:scale-[1.5] lg:data-[large]:scale-[1.15] wide:data-[large]:scale-[1.6]"
            )}
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
          </span>
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
                    ? "text-inverse-foreground hover:bg-inverse-foreground/10"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                {item.label}
              </Link>
            )
          )}
        </nav>

        {/* Held back to `lg`: measured at a 769px viewport, logo (150.7) +
            nav (460) + this button (110.7) came to 721.4px against 721px of
            available width, so the row had literally zero slack and both "О
            нас" and this button's label wrapped onto two lines. The nav still
            carries "Каталог", so nothing becomes unreachable between 768 and
            1024 — and dropping it frees the gap the logo grows into. */}
        <div className="hidden lg:block">
          <Button href="/catalog" size="sm">
            Все товары
          </Button>
        </div>

        <button
          ref={toggleButtonRef}
          type="button"
          className={cn(
            "inline-flex h-11 w-11 items-center justify-center rounded-md transition-colors md:hidden",
            overPhoto ? "text-inverse-foreground" : "text-muted-foreground"
          )}
          onClick={() => (open ? closeMenu() : setOpen(true))}
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
            ref={panelRef}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden border-t border-border bg-card md:hidden"
          >
            {/* Capped to the viewport height left below the sticky header
                (4rem = h-16) so the panel always owns its own scroll area
                instead of growing taller than the screen and leaking
                scroll through to the page behind it — same fix as the
                Каталог/Бренды dropdown below, one level up. Framer still
                measures this div's (now capped) height for the panel's
                open/close animation above, so a short menu is unaffected. */}
            <Container className="flex max-h-[calc(100dvh-4rem)] flex-col gap-1 overflow-y-auto overscroll-contain py-4">
              {mainNav.map((item) => (
                <MobileNavItem
                  key={item.label}
                  item={item}
                  pathname={pathname}
                  isExpanded={expandedLabel === item.label}
                  onToggleExpand={() => setExpandedLabel((current) => (current === item.label ? null : item.label))}
                  onNavigate={closeMenu}
                  handleHashClick={handleHashClick}
                />
              ))}
              <Button href="/catalog" className="mt-2 w-full" onClick={closeMenu}>
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
  pathname,
  isExpanded,
  onToggleExpand,
  onNavigate,
  handleHashClick,
}: {
  item: NavItem;
  pathname: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onNavigate: () => void;
  handleHashClick: (href: string, event: React.MouseEvent) => void;
}) {
  // The mobile panel lives in normal document flow (open, it pushes the
  // page content below it down), so closing it collapses that height and
  // shifts everything under it — including whatever position
  // `scrollIntoView` was just told to scroll to, mid-animation. Closing
  // first and only starting the scroll once that collapse has settled
  // keeps the two from fighting each other instead of racing them.
  // Cross-page hash links skip the delay entirely: Link's normal
  // navigation unmounts this Header, so there's nothing left to race.
  const handleMobileNavClick = (event: React.MouseEvent, href: string) => {
    const hashIndex = href.indexOf("#");
    const targetPath = hashIndex === -1 ? href : href.slice(0, hashIndex) || "/";
    if (targetPath !== pathname) {
      onNavigate();
      return;
    }
    event.preventDefault();
    onNavigate();
    window.setTimeout(() => handleHashClick(href, event), 300);
  };

  if (!item.dropdown) {
    return (
      <Link
        href={item.href}
        onClick={(event) => handleMobileNavClick(event, item.href)}
        className="rounded-md flex min-h-11 items-center px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-primary"
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
          onClick={(event) => handleMobileNavClick(event, item.href)}
          className="flex-1 rounded-md flex min-h-11 items-center px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-primary"
        >
          {item.label}
        </Link>
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-primary"
          aria-expanded={isExpanded}
          aria-label={`Показать подраздел «${item.label}»`}
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", isExpanded && "rotate-180")} />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden pl-3"
          >
            {/* Capped to roughly the height of the shorter "Каталог" list
                (~4 items) so a longer list like "Бренды" scrolls inside
                this box instead of growing the whole mobile panel to
                page length. overscroll-contain stops that internal
                scroll from chaining into the page once it hits either
                end — without it, the page behind the (semi-transparent)
                header visibly scrolls instead. */}
            <div className="grid max-h-60 gap-1 overflow-y-auto overscroll-contain py-1">
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
                      sub.logo ? "border border-border bg-card" : "bg-accent text-accent-foreground"
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
