import { cn } from "@/lib/utils";

interface ProgressBarProps {
  /** 0-100. Callers doing heuristic (not measured) progress should still
   * pass a real number — see ProductFormPhotosSection's estimate — not a
   * fixed value, so the bar visibly moves. */
  percent: number;
  label: string;
  className?: string;
}

// Plain linear progress — no @radix-ui/react-progress pulled in for one use
// case (photo-processing feedback on product create). role="progressbar" is
// enough of a contract that nothing else in the admin needs this component
// to be smarter than "a labeled bar."
export function ProgressBar({ percent, label, className }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className={cn("w-full", className)}>
      <p role="status" className="mb-1.5 text-xs text-muted-foreground">
        {label}
      </p>
      <div
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted/40"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-base ease-ui"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
