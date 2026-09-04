import { HoverBorderGrid } from "@/components/motion/HoverBorderGrid";
import { StaggerGroup, StaggerItem } from "@/components/motion/Stagger";
import { CategoryCard } from "@/components/home/CategoryCard";
import { CARD_GRID_GAP_CLASSNAME, getCardGridSizing } from "@/lib/card-system";
import { cn } from "@/lib/utils";
import type { Category } from "@/types/catalog";

export function CategoryHoverGrid({ categories }: { categories: Category[] }) {
  const sizing = getCardGridSizing(categories.length);

  return (
    <HoverBorderGrid className="mt-8">
      <StaggerGroup
        className={cn("flex flex-wrap justify-center", CARD_GRID_GAP_CLASSNAME, sizing.containerClassName)}
      >
        {categories.map((category) => (
          <StaggerItem key={category.slug} className={sizing.itemClassName}>
            <CategoryCard
              href={`/catalog/category/${category.slug}`}
              image={category.image}
              name={category.name}
            />
          </StaggerItem>
        ))}
      </StaggerGroup>
    </HoverBorderGrid>
  );
}
