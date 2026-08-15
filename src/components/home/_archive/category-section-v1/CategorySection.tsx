import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { StaggerGroup, StaggerItem } from "@/components/motion/Stagger";
import { CategoryCard } from "@/components/home/CategoryCard";
import { getCategories } from "@/lib/queries/categories";
import { getCardGridSizing } from "@/lib/category-grid";
import { cn } from "@/lib/utils";

export async function CategorySection() {
  const categories = await getCategories();
  const sizing = getCardGridSizing(categories.length);
  return (
    <section id="categories" className="scroll-mt-16 py-14 sm:py-16">
      <Container>
        <Reveal>
          <SectionHeading
            eyebrow="Каталог"
            title="Запчасти по типу оборудования"
            description="Выберите категорию, чтобы быстро найти нужные детали."
          />
        </Reveal>
        <StaggerGroup className={cn("mt-8 flex flex-wrap justify-center gap-5", sizing.containerClassName)}>
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
      </Container>
    </section>
  );
}
