import Link from "next/link";
import { MapPin, Package, Phone, ShieldCheck, SlidersHorizontal, Truck, type LucideIcon } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";

interface ValueCard {
  icon: LucideIcon;
  title: string;
  description: string;
}

const values: ValueCard[] = [
  {
    icon: Package,
    title: "Деталь или полный комплект",
    description: "КОМ, гидронасосы, гидромоторы, гидроцилиндры — по отдельности или сразу готовым комплектом.",
  },
  {
    icon: SlidersHorizontal,
    title: "Точная совместимость",
    description: "Подбираем комплектующие под конкретную модель техники — не придётся гадать, подойдёт ли деталь.",
  },
  {
    icon: Truck,
    title: "Без долгого ожидания",
    description: "Из наличия — отправляем сразу. Под заказ — привозим и доставляем по Кыргызстану и странам СНГ.",
  },
];

interface InfoRow {
  icon: LucideIcon;
  label: string;
  value: string;
  href?: string;
}

const infoRows: InfoRow[] = [
  {
    icon: MapPin,
    label: "Адрес",
    value: "г. Бишкек, пр. Дэн Сяопина, 457/1",
  },
  {
    icon: Truck,
    label: "География поставок",
    value: "Кыргызстан и страны СНГ",
  },
  {
    icon: ShieldCheck,
    label: "Гарантия",
    value: "12 месяцев на комплекты",
  },
  {
    icon: Phone,
    label: "Телефон",
    value: "+996 500 461 155",
    href: "tel:+996500461155",
  },
];

export function AboutPreview() {
  return (
    <section id="about" className="scroll-mt-16 py-14 sm:py-16">
      <Container className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-stretch">
        <div>
          <SectionHeading
            eyebrow="О компании"
            title="AYPROM — гидравлика для тягачей, самосвалов и спецтехники"
            description="Когда ломается гидравлика, техника простаивает, а простой стоит денег. Мы быстро подбираем совместимую деталь — от одного насоса до готового комплекта — и отправляем её из наличия или под заказ по Кыргызстану и странам СНГ."
          />

          <div className="mt-6 flex flex-col divide-y divide-border sm:grid sm:grid-cols-3 sm:gap-3 sm:divide-y-0">
            {values.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="flex items-start gap-3 py-3 first:pt-0 sm:block sm:rounded-xl sm:border sm:border-border sm:bg-card sm:p-4 sm:py-4 sm:transition-colors sm:hover:border-blue-200 sm:hover:bg-accent/40"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="sm:mt-3">
                  <p className="text-sm font-semibold text-card-foreground">{title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{description}</p>
                </div>
              </div>
            ))}
          </div>

          <Link
            href="/about"
            className="mt-6 inline-block text-sm font-medium text-primary hover:underline"
          >
            Подробнее о компании →
          </Link>
        </div>

        <div className="flex flex-col gap-5 rounded-2xl border border-blue-100 bg-accent/50 p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <MapPin className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-card-foreground">AYPROM</p>
              <p className="text-xs text-muted-foreground">Бишкек, Кыргызстан</p>
            </div>
          </div>

          <div className="flex flex-1 flex-col justify-center divide-y divide-blue-100">
            {infoRows.map(({ icon: Icon, label, value, href }) => {
              // The row itself must be the direct child of the divide-y list
              // (not wrapped in an extra element) — first:/last: below compile
              // to :first-child/:last-child, which only match against this
              // row's actual position among its siblings here.
              const content = (
                <>
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-sm font-medium text-card-foreground transition-colors group-hover:text-primary">
                      {value}
                    </p>
                  </div>
                </>
              );

              return href ? (
                <a key={label} href={href} className="group flex items-start gap-3 py-4 first:pt-0 last:pb-0">
                  {content}
                </a>
              ) : (
                <div key={label} className="flex items-start gap-3 py-4 first:pt-0 last:pb-0">
                  {content}
                </div>
              );
            })}
          </div>
        </div>
      </Container>
    </section>
  );
}
