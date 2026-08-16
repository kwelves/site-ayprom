"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type ConfirmDialogTone = "primary" | "danger";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  tone?: ConfirmDialogTone;
  onCancel: () => void;
  onConfirm: () => void;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Controlled confirmation dialog for destructive and reversible admin actions.
 * It owns only modal semantics and keyboard focus; callers own their domain state.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  cancelLabel,
  confirmLabel,
  tone = "primary",
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      cancelButtonRef.current?.focus();
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
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;

    const focusableElements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handleKeyDown}
        className={cn(
          "w-full max-w-md rounded-lg bg-card p-5 shadow-lg",
          tone === "danger" ? "border border-warning-border" : "border border-border",
        )}
      >
        <h2 id={titleId} className="text-base font-semibold text-card-foreground">
          {title}
        </h2>
        <div id={descriptionId} className="mt-2 text-sm text-muted-foreground">
          {description}
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-card-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              "rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2",
              tone === "danger"
                ? "border border-danger-border bg-danger-surface text-danger hover:bg-danger-surface-hover focus-visible:ring-danger"
                : "bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:ring-primary focus-visible:ring-offset-2",
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
