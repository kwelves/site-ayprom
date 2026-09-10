import type { Metadata } from "next";
import Link from "next/link";
import { Package, SlidersHorizontal, Wrench, Truck, type LucideIcon } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { StaggerGroup, StaggerItem } from "@/components/motion/Stagger";

export const metadata: Metadata = {
  title: "О компании",
  description:
    "AYPROM поставляет гидрооборудование и запчасти для тягачей, самосвалов и спецтехники: КОМ, насосы, гидромоторы, гидроцилиндры и готовые комплекты.",
  alternates: { canonical: "/about" },
};

interface ValueCard {
  icon: LucideIcon;
  title: string;
  description: string;
}

const values: ValueCard[] = [
  {
    icon: Package,
    title: "Гидравлика и комплекты",
    description: "КОМ, насосы, гидромоторы и гидроцилиндры по отдельности или в составе готового комплекта.",
  },
  {
    icon: SlidersHorizontal,
    title: "Точный подбор",
    description: "Подбираем детали по модели техники, коробке передач и артикулу.",
  },
  {
    icon: Wrench,
    title: "Монтаж и установка",
    description: "Собираем комплект и при необходимости устанавливаем гидравлику под ключ.",
  },
  {
    icon: Truck,
    title: "Доставка",
    description: "Товары из наличия отправляем сразу, остальные привозим под заказ. Доставляем по Кыргызстану и в страны СНГ.",
  },
];

export default function AboutPage() {
  return (
    <Container className="py-16 sm:py-24">
      <Reveal>
        <SectionHeading
          as="h1"
          className="mx-auto text-center"
          eyebrow="О компании"
          title="AYPROM — гидравлика для тягачей, самосвалов и спецтехники"
        />
      </Reveal>

      <Reveal delay={0.05}>
        <div className="mx-auto mt-8 max-w-2xl space-y-4 text-muted-foreground">
          <p>
            AYPROM (Айпром) помогает вернуть технику в работу. Мы поставляем гидрооборудование для тягачей,
            самосвалов, тонаров, полуприцепов, кранов-манипуляторов и другой спецтехники.
          </p>
          <p>
            В каталоге представлены коробки отбора мощности, гидронасосы, гидромоторы, гидроцилиндры и готовые
            комплекты. Подбираем совместимые детали по модели техники, коробке передач и артикулу. При
            необходимости устанавливаем гидравлику под ключ.
          </p>
          <p>
            Товары из наличия отправляем сразу, остальные привозим под заказ. Доставляем по Кыргызстану и в страны
            СНГ. На комплекты действует гарантия 12 месяцев.
          </p>
          <p>
            Работаем без сети франшиз и посредников. На вопросы по совместимости и комплектации отвечает наша
            команда.
          </p>
        </div>
      </Reveal>

      <StaggerGroup className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {values.map(({ icon: Icon, title, description }) => (
          <StaggerItem key={title}>
            <div className="h-full rounded-xl border border-border bg-card p-5 transition-colors hover:border-border-interactive hover:bg-accent/40">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                <Icon className="h-5 w-5" />
              </span>
              <p className="mt-4 text-sm font-semibold text-card-foreground">{title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{description}</p>
            </div>
          </StaggerItem>
        ))}
      </StaggerGroup>

      <Reveal delay={0.1}>
        <div className="mt-14 flex flex-col items-center gap-3 text-center sm:flex-row sm:justify-center sm:gap-6">
          <Link
            href="/catalog"
            className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            Смотреть каталог
          </Link>
          <Link href="/contacts" className="text-sm font-medium text-primary hover:underline">
            Контакты и адрес →
          </Link>
        </div>
      </Reveal>
    </Container>
  );
}
