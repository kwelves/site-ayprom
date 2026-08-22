"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface BulkActionGroup {
  label: string;
  actions: ReactNode;
  mobileClassName?: string;
}

interface BulkActionBarProps {
  count: number;
  itemLabel: (count: number) => string;
  onClear: () => void;
  groups: BulkActionGroup[];
  className?: string;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

// Mobile keeps the persistent control compact and moves the full action set
// into a thumb-friendly bottom sheet. From `sm` upwards all actions remain
// visible in the original floating toolbar.
export function BulkActionBar({ count, itemLabel, onClear, groups, className }: BulkActionBarProps) {
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasMobileSheetOpenRef = useRef(false);
  const titleId = useId();

  useEffect(() => {
    if (count === 0) return;

    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (mobileSheetOpen) {
        setMobileSheetOpen(false);
        return;
      }
      onClear();
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [count, mobileSheetOpen, onClear]);

  useEffect(() => {
    if (mobileSheetOpen) {
      closeButtonRef.current?.focus();
    } else if (wasMobileSheetOpenRef.current) {
      openButtonRef.current?.focus();
    }
    wasMobileSheetOpenRef.current = mobileSheetOpen;
  }, [mobileSheetOpen]);

  function closeMobileSheet() {
    setMobileSheetOpen(false);
  }

  function handleSheetKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMobileSheet();
      return;
    }
    if (event.key !== "Tab") return;

    const focusableElements = Array.from(sheetRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);
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

  if (count === 0) return null;

  return (
    <>
      <div
        role="toolbar"
        aria-label="Массовые действия"
        className={cn(
          "fixed left-1/2 z-40 flex w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-lg sm:hidden",
          className,
        )}
        style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <span className="min-w-0 flex-1 truncate pl-2 text-sm font-semibold text-card-foreground">
          {itemLabel(count)}
        </span>
        <button
          ref={openButtonRef}
          type="button"
          onClick={() => setMobileSheetOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={mobileSheetOpen}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          Изменить
        </button>
        <button
          type="button"
          onClick={onClear}
          aria-label="Снять выделение"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div
        role="toolbar"
        aria-label="Массовые действия"
        className={cn(
          "fixed bottom-4 left-1/2 z-20 hidden w-fit max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-full border border-border bg-card px-4 py-2.5 shadow-lg sm:flex",
          className,
        )}
      >
        <span className="text-sm font-medium text-card-foreground">{itemLabel(count)}</span>
        <div className="flex flex-wrap items-center gap-2">
          {groups.map((group) => (
            <span key={group.label} className="contents">
              {group.actions}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={onClear}
          className="rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-card-foreground"
        >
          Снять выделение
        </button>
      </div>

      {mobileSheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-foreground/40 sm:hidden" onClick={closeMobileSheet}>
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onKeyDown={handleSheetKeyDown}
            onClick={(event) => event.stopPropagation()}
            className="max-h-[calc(100dvh-1rem)] w-full overflow-y-auto rounded-t-3xl border-t border-border bg-card px-4 pt-2 shadow-lg animate-fade-up"
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            <div className="mx-auto h-1 w-10 rounded-full bg-border" aria-hidden="true" />
            <div className="mt-2 flex items-center justify-between gap-3">
              <div>
                <h2 id={titleId} className="text-base font-semibold text-card-foreground">
                  Массовое изменение
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">{itemLabel(count)}</p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeMobileSheet}
                aria-label="Закрыть массовое изменение"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-5 space-y-5">
              {groups.map((group) => (
                <section key={group.label} aria-label={group.label}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </h3>
                  <div
                    className={cn(
                      "grid gap-2 [&>button]:min-h-11 [&>button]:w-full [&>button]:rounded-xl [&>button]:px-3 [&>button]:py-2.5 [&>button]:text-sm",
                      group.mobileClassName,
                    )}
                  >
                    {group.actions}
                  </div>
                </section>
              ))}
            </div>

            <button
              type="button"
              onClick={onClear}
              className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Снять выделение
            </button>
          </div>
        </div>
      )}
    </>
  );
}
