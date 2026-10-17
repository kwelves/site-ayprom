"use client";

import { useSyncExternalStore } from "react";
import { LogOut } from "lucide-react";
import { logout } from "@/lib/admin/actions";
import { AdminNav } from "@/components/admin/AdminNav";
import { AdminPublicationStatus } from "@/components/admin/AdminPublicationStatus";
import { AdminThemeToggle } from "@/components/admin/AdminThemeToggle";
import { AdminMark } from "@/components/admin/ui/AdminMark";
import { buttonClassName } from "@/components/admin/ui/button-styles";
import { cn } from "@/lib/utils";

const COLLAPSED_KEY = "ayprom-admin-sidebar";
const foldListeners = new Set<() => void>();
let foldedThisVisit: boolean | null = null;

function readFolded(): boolean {
  if (foldedThisVisit !== null) return foldedThisVisit;
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function setFolded(value: boolean) {
  foldedThisVisit = value;
  try {
    window.localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    // the fold still applies for this visit
  }
  for (const listener of foldListeners) listener();
}

function subscribeFold(listener: () => void) {
  foldListeners.add(listener);
  return () => foldListeners.delete(listener);
}

// The laptop sidebar (design system v2: 248px, folds to 72px, width moves on a spring in 280ms). The fold is a
// per-browser convenience, remembered when storage allows.
export function AdminSidebar() {
  const collapsed = useSyncExternalStore(subscribeFold, readFolded, () => false);

  function toggle() {
    setFolded(!collapsed);
  }

  return (
    <aside
      data-testid="admin-sidebar"
      data-collapsed={collapsed || undefined}
      className={cn(
        "glass-panel hidden shrink-0 flex-col rounded-[18px] transition-[width] duration-slow ease-spring lg:sticky lg:top-3 lg:z-30 lg:flex lg:h-[calc(100dvh-1.5rem)] lg:self-start",
        collapsed ? "w-[72px]" : "w-[248px]",
      )}
    >
      {/* One edge for everything: expanded, the logo, the highlights, the status card and the buttons all start
          12px from the panel edge; folded, they all sit on the 72px column's centre line. */}
      <div className={cn("flex shrink-0 items-center px-3 pt-3 pb-2", collapsed && "justify-center")}>
        {/* The logo is the fold control; the way to the products list is the first menu item, not the logo. */}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
          aria-expanded={!collapsed}
          title={collapsed ? "Развернуть меню" : "Свернуть меню"}
          className={cn(
            "flex min-w-0 cursor-pointer items-center rounded-[10px] transition-[scale] duration-fast ease-ui active:scale-[0.97] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30",
            !collapsed && "w-full",
          )}
        >
          {/* Expanded, the logo plate spans the menu's full width, edge to edge with the items below it. */}
          {collapsed ? <AdminMark variant="icon" className="h-[35px]" /> : <AdminMark variant="logo" className="h-auto w-full" />}
        </button>
      </div>

      <nav aria-label="Разделы админки" className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-3 py-2 [scrollbar-width:none]")}>
        <AdminNav variant="sidebar" collapsed={collapsed} />
      </nav>

      <div className="mx-3 shrink-0 border-t border-border pt-3">
        <AdminPublicationStatus compact fill placement="side" collapsed={collapsed} />
      </div>

      <div className={cn("mx-3 flex shrink-0 items-center gap-1 py-3", collapsed && "flex-col")}>
        <form action={logout} data-testid="admin-logout" className={cn("shrink-0", !collapsed && "mr-auto")}>
          <button
            type="submit"
            title="Выйти"
            aria-label={collapsed ? "Выйти" : undefined}
            className={buttonClassName({
              variant: "ghost",
              size: collapsed ? "icon" : "md",
              className: cn("sm:h-10", collapsed ? "size-10" : "px-3"),
            })}
          >
            <LogOut aria-hidden="true" />
            {!collapsed && "Выйти"}
          </button>
        </form>
        <AdminThemeToggle className="size-10" />
      </div>
    </aside>
  );
}
