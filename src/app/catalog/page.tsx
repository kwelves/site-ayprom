import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/motion/Reveal";

export const metadata: Metadata = {
  title: "Каталог — AYPROM",
};

export default function CatalogPage() {
  return (
    <Container className="py-16 text-center sm:py-24">
      <Reveal>
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">Каталог</p>
        <h1 className="mt-3 text-2xl font-bold text-foreground sm:text-3xl">Раздел в разработке</h1>
        <p className="mt-3 text-slate-600">
          Полный каталог с поиском и пагинацией появится на следующем этапе разработки.
        </p>
      </Reveal>
    </Container>
  );
}
