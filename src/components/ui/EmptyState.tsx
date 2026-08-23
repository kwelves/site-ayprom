import Link from "next/link";
import { PackageOpen } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, actionHref, actionLabel, action }: EmptyStateProps) {
  return (
    <div className="mx-auto mt-8 max-w-xl rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center">
      <PackageOpen className="mx-auto h-9 w-9 text-muted-foreground" aria-hidden="true" />
      <h2 className="mt-4 text-lg font-semibold text-card-foreground">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
      {action ?? (actionHref && actionLabel && (
        <Link
          href={actionHref}
          className="mt-5 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-[background-color,scale] duration-fast ease-ui hover:scale-[1.02] hover:bg-primary-hover active:scale-[0.98]"
        >
          {actionLabel}
        </Link>
      ))}
    </div>
  );
}
