import { CARD_GRID_GAP_CLASSNAME } from "@/lib/card-system";
import { cn } from "@/lib/utils";

export function LoadingSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse", className)} aria-busy="true" aria-label="Загрузка">
      <div className="h-7 w-48 rounded bg-surface-strong" />
      <div className="mt-3 h-4 w-full max-w-xl rounded bg-surface-strong" />
      <div className={cn("mt-8 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4", CARD_GRID_GAP_CLASSNAME)}>
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="overflow-hidden rounded-xl border border-border bg-card">
            {/* Повторяет геометрию фото-зоны ProductCard: инсет 16px вокруг
                области изображения 4:3, чтобы высота плейсхолдера совпадала
                с высотой готовой карточки. */}
            <div className="bg-surface-strong p-4">
              <div className="aspect-4/3" />
            </div>
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
