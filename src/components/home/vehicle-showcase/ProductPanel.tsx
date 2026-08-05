"use client";

import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { ImageFallback } from "@/components/ui/ImageFallback";
import type { HotspotProduct } from "@/lib/queries/vehicle-hotspots";

interface ProductPanelProps {
  label: string;
  product: HotspotProduct | null;
  isConnected: boolean;
}

export function ProductPanel({ label, product, isConnected }: ProductPanelProps) {
  return (
    <div className="relative">
      {isConnected && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-[1.5px] rounded-2xl opacity-90"
          style={{
            background:
              "conic-gradient(from var(--vs-glow-angle, 0deg), rgba(59,130,246,0) 0%, rgba(191,224,255,0.9) 8%, rgba(59,130,246,0) 24%)",
            animation: "vs-glow-spin 3.2s linear infinite",
          }}
        />
      )}

      <div className="relative flex min-h-[220px] flex-col gap-4 rounded-2xl border border-white/10 bg-[#0b1220] p-5 sm:p-6">
        {product ? (
          <>
            <div className="relative aspect-square w-full max-w-[200px] overflow-hidden rounded-xl bg-white/5">
              <ImageFallback
                src={product.image?.url}
                alt={product.name}
                sizes="200px"
                className="p-4"
                style={product.image?.scale ? { transform: `scale(${product.image.scale})` } : undefined}
              />
            </div>
            <div>
              <p className="text-xs font-semibold tracking-wide text-[#5b9dff] uppercase">{label}</p>
              <h3 className="mt-1 text-lg font-bold text-white">{product.name}</h3>
              <p className="mt-2 text-sm text-slate-300">{product.shortDescription}</p>
            </div>
            <Link
              href={`/product/${product.slug}`}
              className="mt-auto inline-flex items-center gap-1.5 text-sm font-semibold text-[#5b9dff] transition-colors hover:text-[#8fc2ff]"
            >
              Подробнее
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
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
    </div>
  );
}
