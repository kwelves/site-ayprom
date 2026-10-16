import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-[8px] bg-surface-strong", className)} />;
}

// Row-shaped loading placeholder — matches the actual shape of every admin
// list (thumbnail + name + badges), used for the route-level Suspense
// fallback so the loading state doesn't visibly "jump" into a differently
// shaped layout once data arrives. The public site's LoadingSkeleton is a
// card grid instead — the right shape for its product grids, wrong one here.
export function AdminListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="glass-panel mt-5 flex flex-col gap-0.5 rounded-[18px] p-1.5" aria-busy="true" aria-label="Загрузка">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-[12px] px-2 py-2" style={{ opacity: 1 - index * 0.14 }}>
          <Skeleton className="size-14 shrink-0 rounded-[12px]" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/5" />
            <Skeleton className="h-5 w-24 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
