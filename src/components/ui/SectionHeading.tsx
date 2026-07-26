import { cn } from "@/lib/utils";

interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  description?: string;
  className?: string;
  as?: "h1" | "h2";
  tone?: "default" | "inverse";
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  className,
  as = "h2",
  tone = "default",
}: SectionHeadingProps) {
  const Heading = as;
  const isInverse = tone === "inverse";

  return (
    <div className={cn("max-w-2xl", className)}>
      {eyebrow && (
        <p
          className={cn(
            "text-sm font-semibold uppercase tracking-wide",
            isInverse ? "text-blue-300 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]" : "text-primary",
          )}
        >
          {eyebrow}
        </p>
      )}
      <Heading
        className={cn(
          "mt-2 text-2xl font-bold tracking-tight sm:text-3xl",
          isInverse
            ? "text-white drop-shadow-[0_4px_14px_rgba(0,0,0,0.9)]"
            : "text-foreground",
        )}
      >
        {title}
      </Heading>
      {description && (
        <p
          className={cn(
            "mt-3",
            isInverse
              ? "text-slate-100 drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]"
              : "text-slate-600",
          )}
        >
          {description}
        </p>
      )}
    </div>
  );
}
