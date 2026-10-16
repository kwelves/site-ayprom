"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { buttonClassName } from "@/components/admin/ui/button-styles";

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
    // Design system v2, "Окна": darkened scene with a light blur, the dialog comes in from 0.96 on the soft spring.
    // A dangerous action names its object in the title; cancel on the left, the red action on the right.
    <div className="fixed inset-0 z-50 flex animate-[admin-screen-fade_200ms_var(--ease-ui)_both] items-center justify-center bg-overlay p-4 backdrop-blur-[2px]">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handleKeyDown}
        className="glass-float w-full max-w-[460px] animate-[admin-dialog-in_280ms_var(--ease-spring-soft)_both] rounded-[22px] p-6"
      >
        <div className="flex items-start gap-4">
          {tone === "danger" && (
            <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-danger-surface text-danger">
              <TriangleAlert className="size-5" />
            </span>
          )}
          <div className="min-w-0">
            <h2 id={titleId} className="text-[17px] font-semibold tracking-[-0.01em] text-balance text-foreground">
              {title}
            </h2>
            <div id={descriptionId} className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {description}
            </div>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button ref={cancelButtonRef} type="button" onClick={onCancel} className={buttonClassName({ variant: "glass" })}>
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={
              tone === "danger"
                ? buttonClassName({ className: "bg-danger text-primary-foreground hover:brightness-110" })
                : buttonClassName({ variant: "primary" })
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
