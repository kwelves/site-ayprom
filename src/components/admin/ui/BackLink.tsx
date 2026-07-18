import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// A fixed Link rather than router.back() (unlike the public site's
// BackButton) — an admin editor page can be reached directly (bookmark,
// typed URL), where history-based back would exit the admin app entirely
// instead of returning to the list it belongs to.
export function BackLink({ href, label = "Назад" }: { href: string; label?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-primary"
    >
      <ArrowLeft className="h-4 w-4" />
      {label}
    </Link>
  );
}
