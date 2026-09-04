import Image from "next/image";
import Link from "next/link";
import {
  CARD_CAPTION_CLASSNAME,
  CARD_FRAME_CLASSNAME,
  CARD_MEDIA_INSET_CLASSNAME,
  CARD_TITLE_CLASSNAME,
} from "@/lib/card-system";
import { cn } from "@/lib/utils";

interface CategoryCardProps {
  href: string;
  image: string;
  name: string;
  sizes?: string;
}

export function CategoryCard({
  href,
  image,
  name,
  sizes = "(max-width: 639px) 45vw, (max-width: 1023px) 30vw, 320px",
}: CategoryCardProps) {
  return (
    <Link
      href={href}
      data-hover-border-item
      className={cn(
        "group relative flex h-full flex-col overflow-hidden transition-transform duration-fast ease-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:scale-[0.98]",
        CARD_FRAME_CLASSNAME,
      )}
    >
      {/* Инсет на зоне, а не на <img>: только так область изображения остаётся
          ровно 4:3, зазор одинаков с четырёх сторон, а край фотографии
          совпадает с краем подписи ниже. Подробнее — в card-system.ts. */}
      <div className={cn("w-full shrink-0 bg-muted/40", CARD_MEDIA_INSET_CLASSNAME)}>
        <div className="relative aspect-4/3 w-full">
          <Image
            src={image}
            // Пустой alt: название категории уже стоит видимым текстом сразу
            // под фотографией — повтор читался бы скринридером дважды подряд
            // (Lighthouse: image-redundant-alt). Та же причина в BrandCard.
            alt=""
            fill
            unoptimized
            sizes={sizes}
            className="object-contain"
          />
        </div>
      </div>

      <div className={CARD_CAPTION_CLASSNAME}>
        <span data-card-title className={cn(CARD_TITLE_CLASSNAME, "text-card-foreground")}>
          {name}
        </span>
      </div>
    </Link>
  );
}
