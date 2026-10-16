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
  // A success note leaves by itself; an error stays until it is closed (design system v2, "Уведомление").
  useEffect(() => {
    if (!message || tone === "error") return;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [message, tone, onDismiss]);

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          role={tone === "error" ? "alert" : "status"}
          aria-live={tone === "error" ? "assertive" : "polite"}
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1, transition: { type: "spring", duration: 0.45, bounce: 0.18 } }}
          exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: DURATION.fast, ease: EASE_UI } }}
          className={cn(
            "glass-float fixed right-4 bottom-4 z-[70] flex max-w-[calc(100vw-2rem)] items-center gap-3 overflow-hidden rounded-[14px] py-3 pr-2 pl-3.5 sm:right-6 sm:bottom-6",
            tone === "error" && "border-danger-border",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-full",
              tone === "error" ? "bg-danger-surface text-danger" : "bg-success-surface text-success",
            )}
          >
            {tone === "error" ? <AlertCircle className="size-4" /> : <CheckCircle2 className="size-4" />}
          </span>
          <p className="text-sm font-medium text-foreground">{message}</p>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Закрыть уведомление"
            className="ml-1 grid size-8 shrink-0 place-items-center rounded-[8px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
          {tone !== "error" && (
            <span
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-success/50"
              style={{ animation: `admin-toast-timer ${AUTO_DISMISS_MS}ms linear both` }}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
