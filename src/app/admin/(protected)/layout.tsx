import { Suspense } from "react";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { AdminRouteNotice } from "@/components/admin/AdminRouteNotice";
import { AdminToastProvider } from "@/components/admin/ui/AdminToastProvider";

// Wraps every admin page except /admin/login — middleware already gates
// access to this whole subtree, so no auth check here, just the shell.
//
// The working-place shell of the AYPROM design system: a glass sidebar from
// `lg` up (always visible, folds to icons) and the page on the light scene,
// up to 1640px wide, 20px between panels. Below `lg` the sidebar gives way to
// a sticky 60px glass bar with the menu button.
export default function ProtectedAdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AdminToastProvider>
      <Suspense fallback={null}>
        <AdminRouteNotice />
      </Suspense>
      <div data-testid="admin-shell" className="flex min-h-dvh gap-5 p-3">
        <AdminSidebar />
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <AdminTopBar />
          <main id="admin-main" className="mx-auto flex w-full max-w-[1640px] flex-1 flex-col px-1 pb-10 sm:px-2">
            {children}
          </main>
        </div>
      </div>
    </AdminToastProvider>
  );
}
