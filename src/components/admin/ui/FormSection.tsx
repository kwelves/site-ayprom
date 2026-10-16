import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// One part of a long edit form, always open: a glass panel with its title (16px, design system v2 "Заголовок
// панели"), an optional summary on the right (what is filled in, at a glance) and the fields. The id is the anchor
// the form's section bar scrolls to; scroll-margin keeps the title clear of the sticky top bar and section bar.
export function FormSection({
  id,
  title,
  description,
  aside,
  children,
  className,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = `${id}-title`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-form-section
      className={cn("glass-panel scroll-mt-40 rounded-[18px] p-[14px] sm:p-[18px]", className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-base font-semibold tracking-[-0.01em] text-foreground">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{description}</p>}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      <div className="mt-4 space-y-5">{children}</div>
    </section>
  );
}

// A count or short state in a section header ("3 фото", "5 брендов").
export function SectionCount({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "info" | "warning" }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold tabular-nums",
        tone === "neutral" && "bg-neutral-surface text-muted-foreground",
        tone === "info" && "bg-info-surface text-info",
        tone === "warning" && "bg-warning-surface text-warning",
      )}
    >
      {children}
    </span>
  );
}
