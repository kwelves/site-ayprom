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
      className="group/back -ml-2 inline-flex h-9 items-center gap-1.5 rounded-[10px] px-2 text-sm font-medium text-muted-foreground transition-colors duration-fast ease-ui hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
    >
      <ArrowLeft aria-hidden="true" className="size-4 transition-[translate] duration-base ease-ui group-hover/back:-translate-x-0.5" />
      {label}
    </Link>
  );
}
