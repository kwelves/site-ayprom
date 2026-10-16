import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// The head of every admin screen (design system v2): the screen title at 26px (22px on a phone), one quiet line
// of context under it, and on the right the screen's one main action. Size and weight carry the hierarchy; no
// label above the title.
export function AdminPageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0">
        <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] text-balance text-foreground sm:text-[26px]">
          {title}
        </h1>
        {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
