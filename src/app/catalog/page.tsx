import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BackButton } from "@/components/ui/BackButton";
import { Reveal } from "@/components/motion/Reveal";
import { ProductSearchForm } from "@/components/catalog/ProductSearchForm";
import { ProductGridWithSearch } from "@/components/catalog/ProductGridWithSearch";
import { products } from "@/data/products";
import { getProductHref } from "@/lib/product-href";

export const metadata: Metadata = {
  title: "Каталог — AYPROM",
};

interface CatalogPageProps {
  searchParams: Promise<{ q?: string }>;
}

// No shared layout.tsx here on purpose — /catalog/category/[slug] and
// /catalog/brand/[slug] already have their own layout with a BackButton;
// a layout at this level would wrap those too and duplicate the button.
export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const { q } = await searchParams;

  return (
    <Container className="pt-6 pb-16 sm:pt-8 sm:pb-20 lg:pt-10 lg:pb-24">
      <BackButton />
      <div className="mt-[8px]">
        <Reveal>
          <SectionHeading
            className="mx-auto max-w-2xl text-center"
            eyebrow="Каталог"
            title="Все товары"
            description="Выберите категорию или бренд на главной, чтобы быстрее найти нужную позицию."
          />
        </Reveal>

        <div className="mt-6">
          <ProductSearchForm action="/catalog" defaultValue={q} placeholder="Например: гидроцилиндр HOWO" />
        </div>

        {/* products doubles as both scope and global fallback here — /catalog
            has no narrower context, so an empty scoped search naturally
            yields an empty fallback too, and ProductGridWithSearch just
            shows the "nothing found" message with no second-tier grid. */}
        <ProductGridWithSearch
          products={products}
          query={q}
          scopeLabel="в каталоге"
          href={getProductHref}
          emptyLabel="Каталог пока пуст. Скоро здесь появятся товары."
        />
      </div>
    </Container>
  );
}
