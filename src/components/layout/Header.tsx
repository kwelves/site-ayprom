"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu, X } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { NavDropdown } from "@/components/layout/NavDropdown";
import { buildMainNav, type NavItem } from "@/lib/navigation";
import { useScroll } from "@/lib/use-scroll";
import { useHashNavClick } from "@/lib/use-hash-nav-click";
import { DURATION } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useHomeEntrySequence } from "@/components/home/HomeEntrySequence";
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
  const { headerVisible, isHomeRoute } = useHomeEntrySequence();

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
  const mobilePanelId = useId();

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
  const overPhoto = isHomeRoute && !scrolled && !open;

  return (
    <header
      aria-hidden={!headerVisible}
      inert={!headerVisible}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open || event.defaultPrevented) return;
        event.preventDefault();
        closeMenu();
        toggleButtonRef.current?.focus();
      }}
      className={cn(
        "sticky top-0 z-50 w-full border-b border-transparent transition-[opacity,translate,background-color,backdrop-filter,border-color] duration-base ease-ui",
        headerVisible ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0",
        overPhoto ? "bg-transparent" : isHomeRoute ? undefined : "bg-muted",
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
              "inline-flex origin-top-left transition-transform duration-base ease-ui lg:origin-top-right",
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
                  "rounded-md px-3 py-2 text-sm font-medium transition-colors duration-fast ease-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
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
            "inline-flex h-11 w-11 items-center justify-center rounded-md transition-[color,scale] duration-fast ease-ui active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 md:hidden",
            overPhoto ? "text-inverse-foreground" : "text-muted-foreground"
          )}
          onClick={() => (open ? closeMenu() : setOpen(true))}
          aria-label={open ? "Закрыть меню" : "Открыть меню"}
          aria-expanded={open}
          aria-controls={mobilePanelId}
        >
          <span className="relative flex h-6 w-6" aria-hidden="true">
            <Menu
              className={cn(
                "absolute inset-0 h-6 w-6 transition-[opacity,transform] duration-fast ease-ui",
                open ? "-rotate-90 opacity-0" : "rotate-0 opacity-100"
              )}
            />
            <X
              className={cn(
                "absolute inset-0 h-6 w-6 transition-[opacity,transform] duration-fast ease-ui",
                open ? "rotate-0 opacity-100" : "rotate-90 opacity-0"
              )}
            />
          </span>
        </button>
      </Container>

      {/* Keep the panel mounted so opening it never starts with an unpainted
          frame. A CSS grid row can transition between collapsed and natural
          content height without Framer measuring `height: auto` on every
          frame — that measurement plus parent opacity made iOS Safari
          repeatedly re-composite this sticky layer over the playing video. */}
      <div
        id={mobilePanelId}
        ref={panelRef}
        aria-hidden={!open || undefined}
        inert={!open}
        className={cn(
          "grid overflow-hidden transition-[grid-template-rows] ease-ui md:hidden",
          open ? "grid-rows-[1fr] duration-slow" : "pointer-events-none grid-rows-[0fr] duration-base"
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-border bg-card">
            {/* Capped to the viewport height left below the sticky header
                (4rem = h-16) so the panel always owns its own scroll area
                instead of growing taller than the screen and leaking
                scroll through to the page behind it. */}
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
          </div>
        </div>
      </div>
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
  const panelId = useId();
  const toggleButtonRef = useRef<HTMLButtonElement>(null);

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
    window.setTimeout(() => handleHashClick(href, event), DURATION.base * 1000);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "Escape" || !isExpanded) return;
    event.preventDefault();
    event.stopPropagation();
    onToggleExpand();
    toggleButtonRef.current?.focus();
  };

  if (!item.dropdown) {
    return (
      <Link
        href={item.href}
        onClick={(event) => handleMobileNavClick(event, item.href)}
        className="rounded-md flex min-h-11 items-center px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors duration-fast ease-ui hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        {item.label}
      </Link>
    );
  }

  return (
    <div onKeyDown={handleKeyDown}>
      <div className="flex items-center">
        <Link
          href={item.href}
          onClick={(event) => handleMobileNavClick(event, item.href)}
          className="flex-1 rounded-md flex min-h-11 items-center px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors duration-fast ease-ui hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          {item.label}
        </Link>
        <button
          ref={toggleButtonRef}
          type="button"
          onClick={onToggleExpand}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-fast ease-ui hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          aria-expanded={isExpanded}
          aria-controls={panelId}
          aria-label={`${isExpanded ? "Скрыть" : "Показать"} подраздел «${item.label}»`}
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform duration-base ease-ui", isExpanded && "rotate-180")} />
        </button>
      </div>

      <div
        id={panelId}
        aria-hidden={!isExpanded || undefined}
        inert={!isExpanded}
        className={cn(
          "grid overflow-hidden transition-[grid-template-rows] ease-ui",
          isExpanded ? "grid-rows-[1fr] duration-base" : "grid-rows-[0fr] duration-fast"
        )}
      >
        <div className="min-h-0 overflow-hidden pl-3">
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
                  className="flex items-start gap-3 rounded-lg p-2 transition-colors duration-fast ease-ui hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  {sub.logo ? (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-card">
                      {/* eslint-disable-next-line @next/next/no-img-element -- local brand SVGs; next/image blocks them without dangerouslyAllowSVG */}
                      <img src={sub.logo} alt="" className="h-full w-full object-contain p-1" />
                    </span>
                  ) : null}
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-card-foreground">{sub.label}</span>
                    {sub.description && <span className="text-xs text-muted-foreground">{sub.description}</span>}
                  </span>
                </Link>
              ))}
            </div>
        </div>
      </div>
    </div>
  );
}
