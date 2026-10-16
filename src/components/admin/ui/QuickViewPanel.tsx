"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonClassName } from "@/components/admin/ui/button-styles";

interface QuickViewPanelProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

// Slide-over for the products list's "quick view" (PROJECT_BRIEF item 5) —
// same modal/focus-trap contract as ConfirmDialog, just anchored to the
// right edge and wider, since it shows a photo + several fields instead of
// one confirmation question.
export function QuickViewPanel({ open, title, onClose, children, footer }: QuickViewPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const titleId = useId();

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      closeButtonRef.current?.focus();
    } else if (wasOpenRef.current) {
      const trigger = previousFocusRef.current;
      if (trigger?.isConnected) trigger.focus();
      previousFocusRef.current = null;
    }
    wasOpenRef.current = open;
  }, [open]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
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

  if (!open) return null;

  return (
    // Design system v2, "Выдвижная панель": from the right, 12px off the screen edges, radius 22, dense glass;
    // a fixed head, a scrolling body and the actions at the bottom.
    <div
      className="fixed inset-0 z-40 flex animate-[admin-screen-fade_200ms_var(--ease-ui)_both] justify-end bg-overlay p-3 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "glass-float flex h-full w-full max-w-[480px] flex-col rounded-[22px]",
          "animate-[admin-drawer-in_360ms_var(--ease-drawer)_both]",
        )}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
          <h2 id={titleId} className="text-[17px] font-semibold tracking-[-0.01em] text-balance text-foreground">
            {title}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className={buttonClassName({ variant: "ghost", size: "icon", className: "-mt-1 -mr-1" })}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <div className="border-t border-border px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}
