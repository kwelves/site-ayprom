"use client";

import { forwardRef } from "react";
import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { ImageFallback } from "@/components/ui/ImageFallback";
import type { HotspotProduct } from "@/lib/queries/vehicle-hotspots";

interface ProductPanelProps {
  label: string;
  product: HotspotProduct | null;
}

// Single border, full stop — the glowing "connected" outline is drawn by
// the Connector's SVG branches tracing this same card's edges (see
// VehicleShowcaseInteractive), not a second CSS ring layered on top. Two
// separate roundings of "the same edge" is exactly what looked like a
// double border before.
export const ProductPanel = forwardRef<HTMLDivElement, ProductPanelProps>(function ProductPanel(
  { label, product },
  ref,
) {
  return (
    <div
      ref={ref}
      className="relative flex min-h-[220px] flex-col gap-4 rounded-2xl border border-white/15 bg-[#0b1220] p-5 sm:p-6 lg:min-h-0 lg:flex-row lg:items-start lg:gap-3 lg:p-3"
    >
      {product ? (
        <>
          <div className="relative aspect-square w-full max-w-[200px] shrink-0 overflow-hidden rounded-xl bg-white/5 lg:max-w-[90px]">
            <ImageFallback
              src={product.image?.url}
              alt={product.name}
              sizes="200px"
              className="p-4"
              style={product.image?.scale ? { transform: `scale(${product.image.scale})` } : undefined}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col lg:self-stretch">
            <div>
              <p className="text-xs font-semibold tracking-wide text-[#5b9dff] uppercase">{label}</p>
              <h3 className="mt-1 text-lg font-bold text-white lg:text-base">{product.name}</h3>
              <p className="mt-2 text-sm text-slate-300 lg:line-clamp-2 lg:text-xs">{product.shortDescription}</p>
            </div>
            <Link
              href={`/product/${product.slug}`}
              className="mt-auto inline-flex items-center gap-1.5 pt-2 text-sm font-semibold text-[#5b9dff] transition-colors hover:text-[#8fc2ff] lg:text-xs"
            >
              Подробнее
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-white/5 text-[#5b9dff]">
            <Clock aria-hidden="true" className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-semibold tracking-wide text-[#5b9dff] uppercase">{label}</p>
            <p className="mt-1 text-sm text-slate-300">Карточка скоро появится</p>
          </div>
        </div>
      )}
    </div>
  );
});
