import Link from "next/link";
import {
  CARD_CAPTION_CLASSNAME,
  CARD_FRAME_CLASSNAME,
  CARD_MEDIA_INSET_CLASSNAME,
  CARD_TITLE_CLASSNAME,
} from "@/lib/card-system";
import { cn } from "@/lib/utils";
import type { Brand } from "@/types/catalog";

interface BrandCardProps {
  href: string;
  brand: Brand;
  /** Overrides brand.logoScale for this card's logo box. brand.logoScale
   * is tuned for the small homepage badge (BrandSection) — the same factor
   * can overflow this much bigger box, so callers can pass a box-appropriate
   * value here instead of touching the shared brand data. */
  logoScale?: number;
}

// Рамка, инсет и подпись — общие с CategoryCard, отличается только пропорция
// медиа-зоны и то, что логотип рисуется обычным <img>: next/image блокирует
// локальные SVG без images.dangerouslyAllowSVG, а логотипы брендов — SVG.
// Пропорция 2:1 вместо 4:3 намеренная: плоский знак читается визуально
// «крупнее» детальной фотографии того же размера, и в блоке 4:3 он утонул бы
// в пустоте сверху и снизу.
export function BrandCard({ href, brand, logoScale }: BrandCardProps) {
  const scale = logoScale ?? brand.logoScale;

  return (
    <Link
      href={href}
      data-hover-border-item
      className={cn(
        "group relative flex h-full flex-col overflow-hidden transition-transform duration-fast ease-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:scale-[0.98]",
        CARD_FRAME_CLASSNAME,
      )}
    >
      <div className={cn("w-full shrink-0 bg-muted/40", CARD_MEDIA_INSET_CLASSNAME)}>
        <div className="relative aspect-2/1 w-full">
          {/* Absolute + inset-0 (mirroring next/image's `fill`) instead of a flex
              box with max-h/max-w — a flex child's min-height:auto lets portrait
              or square logos (e.g. KAMAZ, DAF, Mercedes-Benz, Volvo) blow out the
              fixed-aspect box; absolute positioning can't be pushed by content. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- static local SVGs are already optimal; next/image blocks local SVGs without dangerouslyAllowSVG */}
          <img
            src={brand.logo}
            // Пустой alt: карточка уже подписана видимым текстом с именем
            // бренда чуть ниже — повтор того же текста в alt читался бы
            // скринридером дважды подряд (Lighthouse: image-redundant-alt).
            alt=""
            width={320}
            height={160}
            className="absolute inset-0 h-full w-full object-contain"
            style={scale ? { transform: `scale(${scale})` } : undefined}
          />
        </div>
      </div>

      <div className={CARD_CAPTION_CLASSNAME}>
        <span data-card-title className={cn(CARD_TITLE_CLASSNAME, "text-card-foreground")}>
          {brand.name}
        </span>
      </div>
    </Link>
  );
}
