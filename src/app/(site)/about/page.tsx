import type { Metadata } from "next";
import Link from "next/link";
import { Package, SlidersHorizontal, Wrench, Truck, type LucideIcon } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { StaggerGroup, StaggerItem } from "@/components/motion/Stagger";

export const metadata: Metadata = {
  title: "О компании — AYPROM",
  description:
    "AYPROM — поставщик гидравлики для тягачей, самосвалов и спецтехники в Бишкеке: коробки отбора мощности, гидронасосы, гидромоторы, гидроцилиндры, готовые комплекты и монтаж.",
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
    description: "КОМ, гидронасосы, гидромоторы, гидроцилиндры — по отдельности или готовым комплектом.",
  },
  {
    icon: SlidersHorizontal,
    title: "Точный подбор",
    description: "Подбираем комплектующие под конкретную модель техники, а не наугад.",
  },
  {
    icon: Wrench,
    title: "Монтаж и установка",
    description: "Если нужно — устанавливаем гидравлику под ключ, а не просто продаём деталь.",
  },
  {
    icon: Truck,
    title: "Доставка",
    description: "Из наличия — сразу. Под заказ — привозим и доставляем по Кыргызстану и странам СНГ.",
  },
];

export default function AboutPage() {
  return (
    <Container className="py-16 sm:py-24">
      <Reveal>
        <SectionHeading
          className="mx-auto text-center"
          eyebrow="О компании"
          title="AYPROM — гидравлика для тягачей, самосвалов и спецтехники"
        />
      </Reveal>

      <Reveal delay={0.05}>
        <div className="mx-auto mt-8 max-w-2xl space-y-4 text-slate-600">
          <p>
            Мы закрываем одну простую задачу: чтобы поломка гидравлического узла не останавливала вашу технику
            надолго. Работаем из Бишкека с тягачами, самосвалами, тонарами, полуприцепами, кранами-манипуляторами и
            другой спецтехникой.
          </p>
          <p>
            В работе — коробки отбора мощности, гидронасосы, гидромоторы, гидроцилиндры и готовые комплекты
            гидравлики. Подбираем совместимые детали под конкретную модель техники и, если нужно, берём на себя
            монтаж — устанавливаем гидравлику под ключ, а не просто продаём деталь.
          </p>
          <p>
            Часть позиций всегда есть в наличии, остальное привозим под заказ. Отгружаем не только по Бишкеку —
            доставляем по всем областям Кыргызстана и в страны СНГ. На комплекты действует гарантия 12 месяцев.
          </p>
          <p>
            Мы работаем по одному адресу в Бишкеке, без сети франшиз и посредников — поэтому на любой вопрос по
            технике отвечаем сами, напрямую.
          </p>
        </div>
      </Reveal>

      <StaggerGroup className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {values.map(({ icon: Icon, title, description }) => (
          <StaggerItem key={title}>
            <div className="h-full rounded-xl border border-border bg-card p-5 transition-colors hover:border-blue-200 hover:bg-accent/40">
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
            className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-blue-700"
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
