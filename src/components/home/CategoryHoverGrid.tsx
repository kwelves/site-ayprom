import Image from "next/image";
import Link from "next/link";
import { HoverBorderGrid } from "@/components/motion/HoverBorderGrid";
import { StaggerGroup, StaggerItem } from "@/components/motion/Stagger";
import { getCardGridSizing } from "@/lib/category-grid";
import { cn } from "@/lib/utils";
import type { Category } from "@/types/catalog";

export function CategoryHoverGrid({ categories }: { categories: Category[] }) {
  const sizing = getCardGridSizing(categories.length);

  return (
    <HoverBorderGrid className="mt-8">
      <StaggerGroup className={cn("flex flex-wrap justify-center gap-5", sizing.containerClassName)}>
        {categories.map((category) => (
          <StaggerItem key={category.slug} className={sizing.itemClassName}>
            <Link
              href={`/catalog/category/${category.slug}`}
              data-hover-border-item
              className="relative block h-full w-full p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:scale-[0.98]"
            >
              <div className="relative z-10 flex h-full flex-col overflow-hidden rounded-xl border border-card-edge bg-card">
                <div className="relative aspect-4/3 w-full shrink-0 bg-muted/40">
                  <Image
                    src={category.image}
                    // Пустой alt: название категории уже видимым текстом
                    // сразу под фото (см. BrandCard.tsx — та же причина,
                    // Lighthouse отмечал это как image-redundant-alt).
                    alt=""
                    fill
                    unoptimized
                    sizes="(max-width: 639px) 45vw, (max-width: 1023px) 30vw, 320px"
                    className="object-contain p-5"
                  />
                </div>

                <div className="px-4 py-3.5 text-center">
                  <span data-card-title className="text-sm font-medium text-card-foreground">
                    {category.name}
                  </span>
                </div>
              </div>
            </Link>
          </StaggerItem>
        ))}
      </StaggerGroup>
    </HoverBorderGrid>
  );
}
