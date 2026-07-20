"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, X } from "lucide-react";

const AUTO_DISMISS_MS = 4000;

export function Toast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.2 }}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-lg"
        >
          <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
          <p className="text-sm font-medium text-card-foreground">{message}</p>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Закрыть уведомление"
            className="ml-2 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
