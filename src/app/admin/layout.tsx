import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Админка — AYPROM",
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
    <html lang="ru" className={`${geistSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}
