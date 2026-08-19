"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Menu, X } from "lucide-react";
import { AdminNav } from "@/components/admin/AdminNav";
import { logout } from "@/lib/admin/actions";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

// Below `lg` the sidebar (AdminLayout) is hidden — this hamburger + drawer
// is the only way to reach the other 6 sections, so it has to be reliable:
// same focus-trap contract as ConfirmDialog/QuickViewPanel (Esc closes,
// Tab wraps inside), just anchored to the left edge.
export function AdminMobileNav() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    openButtonRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;

    const focusableElements = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);
    if (focusableElements.length === 0) return;

    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <button
        ref={openButtonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Открыть меню разделов"
        aria-expanded={open}
        className="rounded-md p-2 text-card-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex bg-foreground/40" onClick={close}>
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onKeyDown={handleKeyDown}
            onClick={(event) => event.stopPropagation()}
            className="flex h-full w-72 max-w-[80vw] flex-col border-r border-border bg-card shadow-lg animate-slide-in-left"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
              <span id={titleId} className="text-sm font-semibold text-card-foreground">
                AYPROM — Админка
              </span>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={close}
                aria-label="Закрыть меню"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
              <AdminNav variant="sidebar" onNavigate={close} />
            </nav>
            <form action={logout} className="border-t border-border p-3">
              <button
                type="submit"
                className="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-card-foreground"
              >
                Выйти
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
