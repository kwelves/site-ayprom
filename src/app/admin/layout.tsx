import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: "Админка — AYPROM",
  icons: {
    icon: [{ url: "/brand/ayprom-icon.svg", type: "image/svg+xml" }],
    shortcut: "/brand/ayprom-icon.svg",
    apple: "/brand/ayprom-icon-light.png",
  },
  robots: { index: false, follow: false },
};

// A second, independent root layout (Next.js "multiple root layouts" via
// route groups) — the admin panel deliberately has none of the public
// site's chrome (Header/Footer/ScrollToHash/ResetScrollOnNavigate). The nav
// bar itself lives one level deeper, in (protected)/layout.tsx, so the
// unauthenticated /admin/login page doesn't show a "Выйти" button for a
// session that doesn't exist yet.
export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body data-admin-root className="flex min-h-full flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
