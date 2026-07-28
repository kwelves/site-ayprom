import { cn } from "@/lib/utils";

interface CornerBracketProps {
  className?: string;
  size?: number;
  inset?: number;
}

const CORNERS = [
  { position: "left-0 top-0", border: "border-l border-t" },
  { position: "right-0 top-0", border: "border-r border-t" },
  { position: "bottom-0 left-0", border: "border-b border-l" },
  { position: "bottom-0 right-0", border: "border-b border-r" },
] as const;

// Four engineering-drawing corner marks around a container (Hero video only —
// see docs/design-orchestration/06-council-result.md §5). Server-only,
// aria-hidden, absolutely positioned relative to the nearest `relative`
// ancestor; never intercepts focus or clicks.
export function CornerBracket({ className, size = 20, inset = 16 }: CornerBracketProps) {
  return (
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-0", className)}>
      {CORNERS.map(({ position, border }) => (
        <span
          key={position}
          className={cn("absolute border-grid-line", position, border)}
          style={{ width: size, height: size, borderWidth: "1.5px", margin: inset }}
        />
      ))}
    </div>
  );
}
