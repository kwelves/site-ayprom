"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Menu, X } from "lucide-react";
import { AdminNav } from "@/components/admin/AdminNav";
import { AdminSettingsMenu } from "@/components/admin/AdminSettingsMenu";
import { AdminMark } from "@/components/admin/ui/AdminMark";
import { buttonClassName } from "@/components/admin/ui/button-styles";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

// Below `lg` the sidebar is hidden — this menu button + drawer is the only way
// to reach the other sections, so it has to be reliable: same focus-trap
// contract as ConfirmDialog/QuickViewPanel (Esc closes, Tab wraps inside),
// just anchored to the left edge, 12px away from the screen edges like every
// floating glass panel of the system.
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
        className={buttonClassName({ variant: "ghost", size: "icon", className: "text-foreground" })}
      >
        <Menu aria-hidden="true" />
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex animate-[admin-screen-fade_200ms_var(--ease-ui)_backwards] bg-overlay p-3 backdrop-blur-[2px]" onClick={close}>
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onKeyDown={handleKeyDown}
            onClick={(event) => event.stopPropagation()}
            className="glass-float flex h-full w-[300px] max-w-[86vw] animate-slide-in-left flex-col rounded-[22px]"
          >
            <div className="flex h-[68px] shrink-0 items-center justify-between px-4">
              <span id={titleId} className="sr-only">
                AYPROM · Админка
              </span>
              <AdminMark variant="logo" size="md" />
              <button
                ref={closeButtonRef}
                type="button"
                onClick={close}
                aria-label="Закрыть меню"
                className={buttonClassName({ variant: "ghost", size: "icon" })}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <nav aria-label="Разделы админки" className="flex flex-1 flex-col overflow-y-auto px-3 py-2">
              <AdminNav variant="sidebar" onNavigate={close} />
            </nav>
            <div className="shrink-0 p-3">
              <AdminSettingsMenu onNavigate={close} className="w-full" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
