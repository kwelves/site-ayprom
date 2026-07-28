import { cn } from "@/lib/utils";

interface HairlineDividerProps {
  className?: string;
  orientation?: "horizontal" | "vertical";
}

// Decorative engineering-datasheet accent (docs/design-orchestration/06-council-result.md
// §10-11). Server-only, aria-hidden, never intercepts focus or clicks.
export function HairlineDivider({ className, orientation = "horizontal" }: HairlineDividerProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none bg-hairline",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
    />
  );
}
