import Link from "next/link";
import { logout } from "@/lib/admin/actions";

// Wraps every admin page except /admin/login — middleware already gates
// access to this whole subtree, so no auth check here, just the nav chrome.
export default function ProtectedAdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/admin/products" className="text-sm font-semibold text-card-foreground">
            AYPROM — Админка
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/admin/products" className="text-slate-600 transition-colors hover:text-primary">
              Товары
            </Link>
            <Link href="/admin/brands" className="text-slate-600 transition-colors hover:text-primary">
              Бренды
            </Link>
            <Link href="/admin/categories" className="text-slate-600 transition-colors hover:text-primary">
              Категории
            </Link>
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
