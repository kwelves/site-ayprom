import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BackButton } from "@/components/ui/BackButton";
import { Reveal } from "@/components/motion/Reveal";
import { StaggerGroup, StaggerItem } from "@/components/motion/Stagger";
import { ProductCard } from "@/components/catalog/ProductCard";
import { products } from "@/data/products";
import { getProductHref } from "@/lib/product-href";

export const metadata: Metadata = {
  title: "Каталог — AYPROM",
};

// No shared layout.tsx here on purpose — /catalog/category/[slug] and
// /catalog/brand/[slug] already have their own layout with a BackButton;
// a layout at this level would wrap those too and duplicate the button.
export default function CatalogPage() {
  return (
    <Container className="pt-6 pb-16 sm:pt-8 sm:pb-20 lg:pt-10 lg:pb-24">
      <BackButton />
      <div className="mt-[15px]">
        <Reveal>
          <SectionHeading
            className="mx-auto max-w-2xl text-center"
            eyebrow="Каталог"
            title="Все товары"
            description="Выберите категорию или бренд на главной, чтобы быстрее найти нужную позицию."
          />
        </Reveal>

        {products.length > 0 ? (
          <StaggerGroup className="mt-10 grid grid-cols-2 gap-5 lg:grid-cols-4">
            {products.map((product) => (
              <StaggerItem key={product.slug}>
                <ProductCard product={product} href={getProductHref(product)} />
              </StaggerItem>
            ))}
          </StaggerGroup>
        ) : (
          <p className="mt-10 text-center text-slate-600">Каталог пока пуст. Скоро здесь появятся товары.</p>
        )}
      </div>
    </Container>
  );
}
