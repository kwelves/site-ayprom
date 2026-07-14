"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface BackButtonProps {
  className?: string;
}

// Uses router.back() (browser History API) rather than a Link to a fixed URL,
// so the browser's native scroll restoration puts the user back exactly where
// they clicked, instead of at the top of the previous page.
export function BackButton({ className }: BackButtonProps) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.back()}
      className={cn(
        "inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 transition-colors hover:text-primary",
        className
      )}
    >
      <ArrowLeft className="h-4 w-4" />
      Назад
    </button>
  );
}
