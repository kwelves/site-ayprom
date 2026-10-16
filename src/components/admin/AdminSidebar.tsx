"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { logout } from "@/lib/admin/actions";
import { AdminNav } from "@/components/admin/AdminNav";
import { AdminPublicationStatus } from "@/components/admin/AdminPublicationStatus";
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
        "glass-panel hidden shrink-0 flex-col overflow-hidden rounded-[18px] transition-[width] duration-slow ease-spring lg:sticky lg:top-3 lg:flex lg:h-[calc(100dvh-1.5rem)] lg:self-start",
        collapsed ? "w-[72px]" : "w-[248px]",
      )}
    >
      <div className={cn("flex h-[68px] shrink-0 items-center", collapsed ? "justify-center px-0" : "px-[18px]")}>
        <Link
          href="/admin/products"
          className="flex min-w-0 items-center rounded-[10px] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
          aria-label="AYPROM · Админка, к товарам"
          title="AYPROM · Админка"
        >
          {collapsed ? <AdminMark variant="icon" size="sm" /> : <AdminMark variant="logo" size="md" />}
        </Link>
      </div>

      <nav aria-label="Разделы админки" className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-3 py-2">
        <AdminNav variant="sidebar" collapsed={collapsed} />
      </nav>

      <div className={cn("shrink-0 px-3", collapsed && "flex justify-center")}>
        <AdminPublicationStatus collapsed={collapsed} />
      </div>

      <div className={cn("flex shrink-0 items-center gap-1 p-3", collapsed && "flex-col")}>
        <form action={logout} data-testid="admin-logout" className={cn("shrink-0", !collapsed && "min-w-0 grow")}>
          <button
            type="submit"
            title="Выйти"
            aria-label={collapsed ? "Выйти" : undefined}
            className={buttonClassName({
              variant: "ghost",
              size: collapsed ? "icon" : "md",
              className: cn(!collapsed && "w-full justify-start px-3"),
            })}
          >
            <LogOut aria-hidden="true" />
            {!collapsed && "Выйти"}
          </button>
        </form>
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
          title={collapsed ? "Развернуть меню" : "Свернуть меню"}
          className={buttonClassName({ variant: "ghost", size: "icon" })}
        >
          {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
        </button>
      </div>
    </aside>
  );
}
