"use client";

import { Moon, Sun } from "lucide-react";
import { applyAdminTheme, useAdminTheme } from "@/lib/admin/theme";
import { buttonClassName } from "@/components/admin/ui/button-styles";
import { cn } from "@/lib/utils";

// The moon of the top bar. The icon turns as it swaps (sun and moon share one place), so the change reads as one
// switch rather than two different buttons.
export function AdminThemeToggle({ className }: { className?: string }) {
  const theme = useAdminTheme();

  function toggle() {
    applyAdminTheme(theme === "dark" ? "light" : "dark", { remember: true });
  }

  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Светлая тема" : "Тёмная тема"}
      title={dark ? "Светлая тема" : "Тёмная тема"}
      className={buttonClassName({ variant: "ghost", size: "icon", className: cn("overflow-hidden", className) })}
    >
      <span className="relative grid size-[18px] place-items-center">
        <Moon
          aria-hidden="true"
          className={cn(
            "absolute transition-[opacity,rotate,scale] duration-slow ease-spring-soft",
            dark ? "scale-50 -rotate-90 opacity-0" : "opacity-100",
          )}
        />
        <Sun
          aria-hidden="true"
          className={cn(
            "absolute transition-[opacity,rotate,scale] duration-slow ease-spring-soft",
            dark ? "opacity-100" : "scale-50 rotate-90 opacity-0",
          )}
        />
      </span>
    </button>
  );
}
