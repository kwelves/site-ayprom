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
        "fixed bottom-6 right-6 z-50 flex max-w-md items-start gap-3 rounded-lg border bg-card px-4 py-3 shadow-lg",
        tone === "error" ? "border-red-200" : "border-border",
      )}
    >
      <Icon aria-hidden="true" className={cn("mt-0.5 h-5 w-5 shrink-0", tone === "error" ? "text-red-600" : "text-primary")} />
      <p className="text-sm font-medium text-card-foreground">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Закрыть уведомление"
        className="ml-2 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}
