import Link from "next/link";
import { logout } from "@/lib/admin/actions";
import { AdminNav } from "@/components/admin/AdminNav";

// Wraps every admin page except /admin/login — middleware already gates
// access to this whole subtree, so no auth check here, just the nav chrome.
export default function ProtectedAdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {/* flex-wrap + min-h (not a fixed h-14) — the nav row didn't fit
          logo + 4 links + logout on one line on narrow phones and had
          nothing forcing it to wrap, so it just bled past its own
          container's right edge instead of breaking onto a second line. */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
          <Link href="/admin/products" className="text-sm font-semibold text-card-foreground">
            AYPROM — Админка
          </Link>
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <AdminNav />
            <form action={logout}>
              <button
                type="submit"
                className="text-slate-600 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Выйти
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </>
  );
}
