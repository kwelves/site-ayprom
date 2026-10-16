"use client";

import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface AdminActionFeedbackProps {
  message: string | null;
  tone?: "success" | "error";
  onDismiss: () => void;
}

export function AdminActionFeedback({ message, tone = "error", onDismiss }: AdminActionFeedbackProps) {
  if (!message) return null;

  const Icon = tone === "success" ? CheckCircle2 : AlertCircle;

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live="polite"
      className={cn(
        "glass-float fixed right-4 bottom-4 z-[70] flex max-w-md animate-[admin-toast-in_320ms_var(--ease-spring)_backwards] items-start gap-3 rounded-[14px] py-3 pr-2 pl-3.5 sm:right-6 sm:bottom-6",
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
        <Icon className="size-4" />
      </span>
      <p className="pt-1 text-sm font-medium text-foreground">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Закрыть уведомление"
        className="ml-1 grid size-8 shrink-0 place-items-center rounded-[8px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
