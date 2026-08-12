import { cn } from "@/lib/utils";

export function LoadingSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse", className)} aria-busy="true" aria-label="Загрузка">
      <div className="h-7 w-48 rounded bg-surface-strong" />
      <div className="mt-3 h-4 w-full max-w-xl rounded bg-surface-strong" />
      <div className="mt-8 grid grid-cols-2 gap-5 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="aspect-square bg-surface-strong" />
            <div className="space-y-2 p-4">
              <div className="h-4 w-4/5 rounded bg-surface-strong" />
              <div className="h-3 w-full rounded bg-surface-subtle" />
              <div className="h-3 w-2/3 rounded bg-surface-subtle" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
