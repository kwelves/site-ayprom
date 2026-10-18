"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { KeyRound, LogOut, Moon, Settings, Sun } from "lucide-react";
import { logout } from "@/lib/admin/actions";
import { applyAdminTheme, useAdminTheme } from "@/lib/admin/theme";
import { buttonClassName } from "@/components/admin/ui/button-styles";
import { cn } from "@/lib/utils";

export const PASSWORD_PATH = "/admin/security";

const itemClassName =
  "group/item flex h-10 w-full items-center gap-3 rounded-[10px] px-3 text-left text-sm font-medium text-foreground transition-colors duration-fast ease-ui hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30";
const iconClassName = "size-[18px] shrink-0 text-muted-foreground transition-[color,scale] duration-base ease-spring-soft group-hover/item:scale-[1.08] group-hover/item:text-foreground";

interface AdminSettingsMenuProps {
  /** Sidebar folded to icons: the trigger is a square and the panel opens to the right of the sidebar. */
  collapsed?: boolean;
  onNavigate?: () => void;
  className?: string;
}

// The one place for account-level actions, at the very bottom of the menu: switch the theme, change the password,
// sign out. A small glass panel opens above the button (beside it when the sidebar is folded) and closes on a click
// outside, on Escape and after the choice.
export function AdminSettingsMenu({ collapsed = false, onNavigate, className }: AdminSettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const theme = useAdminTheme();
  const dark = theme === "dark";

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} data-testid="admin-settings" className={cn("relative shrink-0", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={collapsed ? "Настройки" : undefined}
        title={collapsed ? "Настройки" : undefined}
        className={buttonClassName({
          variant: "ghost",
          size: collapsed ? "icon" : "md",
          className: cn("sm:h-10", collapsed ? "size-10" : "w-full justify-start gap-3 px-3", open && "bg-accent text-foreground"),
        })}
      >
        <Settings aria-hidden="true" className={cn("transition-[rotate] duration-slow ease-spring-soft", open && "rotate-45")} />
        {!collapsed && "Настройки"}
      </button>

      {open && (
        <div
          id={panelId}
          role="group"
          aria-label="Настройки"
          className={cn(
            "glass-float absolute z-50 flex animate-[admin-dialog-in_160ms_var(--ease-ui)_backwards] flex-col gap-0.5 rounded-[14px] p-1.5",
            collapsed ? "bottom-0 left-full ml-3 w-[232px] origin-bottom-left" : "right-0 bottom-full left-0 mb-2 origin-bottom",
          )}
        >
          <button
            type="button"
            onClick={() => applyAdminTheme(dark ? "light" : "dark", { remember: true })}
            className={itemClassName}
          >
            {dark ? <Sun aria-hidden="true" className={iconClassName} /> : <Moon aria-hidden="true" className={iconClassName} />}
            {dark ? "Светлая тема" : "Тёмная тема"}
          </button>
          <Link
            href={PASSWORD_PATH}
            onClick={() => {
              setOpen(false);
              onNavigate?.();
            }}
            className={itemClassName}
          >
            <KeyRound aria-hidden="true" className={iconClassName} />
            Сменить пароль
          </Link>
          <div aria-hidden="true" className="mx-2 my-1 h-px bg-border" />
          <form action={logout} data-testid="admin-logout">
            <button type="submit" className={cn(itemClassName, "hover:bg-danger-surface hover:text-danger")}>
              <LogOut aria-hidden="true" className={cn(iconClassName, "group-hover/item:text-danger")} />
              Выйти
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
