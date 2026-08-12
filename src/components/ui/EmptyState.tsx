import Link from "next/link";
import { PackageOpen } from "lucide-react";

interface EmptyStateProps {
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
}

export function EmptyState({ title, description, actionHref, actionLabel }: EmptyStateProps) {
  return (
    <div className="mx-auto mt-8 max-w-xl rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center">
      <PackageOpen className="mx-auto h-9 w-9 text-muted-foreground" aria-hidden="true" />
      <h2 className="mt-4 text-lg font-semibold text-card-foreground">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
      {actionHref && actionLabel && (
        <Link
          href={actionHref}
          className="mt-5 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
