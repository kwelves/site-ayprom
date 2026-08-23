"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { DURATION, EASE_UI } from "@/lib/motion";
import { cn } from "@/lib/utils";

const AUTO_DISMISS_MS = 4000;

export type ToastTone = "success" | "error";

export function Toast({
  message,
  tone = "success",
  onDismiss,
}: {
  message: string | null;
  tone?: ToastTone;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          role={tone === "error" ? "alert" : "status"}
          aria-live={tone === "error" ? "assertive" : "polite"}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE_UI } }}
          exit={{ opacity: 0, y: 8, transition: { duration: DURATION.fast, ease: EASE_UI } }}
          className={cn(
            "fixed bottom-6 right-6 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-lg",
            tone === "error" ? "border-danger-border" : "border-border",
          )}
        >
          {tone === "error" ? (
            <AlertCircle aria-hidden="true" className="h-5 w-5 shrink-0 text-danger" />
          ) : (
            <CheckCircle2 aria-hidden="true" className="h-5 w-5 shrink-0 text-primary" />
          )}
          <p className="text-sm font-medium text-card-foreground">{message}</p>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Закрыть уведомление"
            className="ml-2 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
