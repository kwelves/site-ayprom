"use client";

import { Package } from "lucide-react";
import { ImageFallback } from "@/components/ui/ImageFallback";
import type { AdminProductListItem } from "@/lib/admin/queries";

// The product photo in a list row, large enough to tell parts apart (56px). With a mouse, resting on it shows the
// photo at 240px beside the row after a short pause, so a glance down the list does not flash previews; the
// enlarged copy is the same file the row already loaded. Touch screens open the quick view on tap instead.
export function ProductThumb({ product, onOpen }: { product: AdminProductListItem; onOpen: () => void }) {
  return (
    <span className="group/thumb relative block shrink-0">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Быстрый просмотр товара «${product.name}»`}
        className="glass-plate relative grid size-14 place-items-center overflow-hidden rounded-[12px] transition-[scale] duration-fast ease-ui active:scale-[0.97] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
      >
        {product.coverImage ? (
          <ImageFallback
            src={product.coverImage}
            fallbackSrc={product.coverImageFallback ?? undefined}
            alt=""
            sizes="56px"
            unoptimized
            className="size-full object-contain p-1 transition-[scale] duration-base ease-ui pointer-fine:group-hover/thumb:scale-[1.06]"
          />
        ) : (
          <Package aria-hidden="true" className="size-5 text-faint-foreground" />
        )}
      </button>

      {product.coverImage && (
        <span
          aria-hidden="true"
          className="glass-float pointer-events-none absolute top-1/2 left-full z-20 ml-3 hidden size-60 origin-left -translate-y-1/2 scale-95 rounded-[18px] p-3 opacity-0 transition-[opacity,scale] duration-fast ease-ui pointer-fine:block pointer-fine:group-hover/thumb:scale-100 pointer-fine:group-hover/thumb:opacity-100 pointer-fine:group-hover/thumb:delay-200 pointer-fine:group-hover/thumb:duration-base"
        >
          <ImageFallback
            src={product.coverImage}
            fallbackSrc={product.coverImageFallback ?? undefined}
            alt=""
            sizes="240px"
            unoptimized
            className="size-full rounded-[12px] object-contain"
          />
        </span>
      )}
    </span>
  );
}
