"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Loader2, Undo2, X } from "lucide-react";
import { DURATION, EASE_UI } from "@/lib/motion";

const AUTO_DISMISS_MS = 9000;

interface AdminUndoToastProps {
  toast: { id: number; message: string } | null;
  actionLabel?: string;
  pending?: boolean;
  onAction?: () => void;
  onDismiss: () => void;
}

export function AdminUndoToast({ toast, actionLabel, pending = false, onAction, onDismiss }: AdminUndoToastProps) {
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [onDismiss, toast]);

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE_UI } }}
          exit={{ opacity: 0, y: 8, transition: { duration: DURATION.fast, ease: EASE_UI } }}
          className="fixed bottom-6 right-6 z-50 flex max-w-md items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-lg"
        >
          <CheckCircle2 aria-hidden="true" className="h-5 w-5 shrink-0 text-primary" />
          <p className="text-sm font-medium text-card-foreground">{toast.message}</p>
          {actionLabel && onAction && (
            <button
              type="button"
              onClick={onAction}
              disabled={pending}
              className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold text-primary transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-70"
            >
              {pending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Undo2 aria-hidden="true" className="h-4 w-4" />}
              {pending ? "Отмена…" : actionLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Закрыть уведомление"
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
