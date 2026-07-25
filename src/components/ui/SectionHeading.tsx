import { cn } from "@/lib/utils";

interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  description?: string;
  className?: string;
  as?: "h1" | "h2";
}

export function SectionHeading({ eyebrow, title, description, className, as = "h2" }: SectionHeadingProps) {
  const Heading = as;
  return (
    <div className={cn("max-w-2xl", className)}>
      {eyebrow && (
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">{eyebrow}</p>
      )}
      <Heading className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        {title}
      </Heading>
      {description && <p className="mt-3 text-slate-600">{description}</p>}
    </div>
  );
}
