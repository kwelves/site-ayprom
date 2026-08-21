import Link from "next/link";
import { logout } from "@/lib/admin/actions";
import { AdminNav } from "@/components/admin/AdminNav";
import { AdminMobileNav } from "@/components/admin/AdminMobileNav";

// Wraps every admin page except /admin/login — middleware already gates
// access to this whole subtree, so no auth check here, just the nav chrome.
//
// Persistent left sidebar from `lg` up (Linear/Stripe-style — always
// visible, no need to open anything to switch section); below that, a
// hamburger + drawer (AdminMobileNav) replaces it, since 8 sections don't
// fit a bottom tab bar without truncation.
export default function ProtectedAdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card lg:flex">
        <div className="border-b border-border px-4 py-4">
          <Link href="/admin/products" className="text-sm font-semibold text-card-foreground">
            AYPROM — Админка
          </Link>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          <AdminNav variant="sidebar" />
        </nav>
        <form action={logout} className="border-t border-border p-3">
          <button
            type="submit"
            className="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Выйти
          </button>
        </form>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border bg-card px-4 py-2.5 lg:hidden">
          <Link href="/admin/products" className="text-sm font-semibold text-card-foreground">
            AYPROM — Админка
          </Link>
          <AdminMobileNav />
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      </div>
    </div>
  );
}
