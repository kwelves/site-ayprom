"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface BackButtonProps {
  className?: string;
  fallbackHref?: string;
}

type WindowWithNavigation = Window & {
  navigation?: {
    canGoBack: boolean;
  };
};

function hasSafeSameOriginBackTarget() {
  const navigation = (window as WindowWithNavigation).navigation;
  if (navigation) return navigation.canGoBack;

  if (window.history.length <= 1 || !document.referrer) return false;
  try {
    return new URL(document.referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

// Preserve native back/scroll restoration for a known same-origin entry. A
// direct, bookmarked or cross-origin visit instead replaces the current entry
// with a predictable public route, so "Назад" never exits the site or no-ops.
export function BackButton({ className, fallbackHref = "/catalog" }: BackButtonProps) {
  const router = useRouter();

  const handleClick = () => {
    if (hasSafeSameOriginBackTarget()) {
      router.back();
      return;
    }
    router.replace(fallbackHref);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md py-3 text-sm font-medium text-muted-foreground transition-[color,scale] duration-fast ease-ui active:scale-95 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:py-0",
        className
      )}
    >
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />
      Назад
    </button>
  );
}
