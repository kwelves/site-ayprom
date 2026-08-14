import Image from "next/image";
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
    <section id="about" className="scroll-mt-16 bg-muted py-14 sm:py-16">
      <Container className="grid gap-8 lg:grid-cols-[1fr_1.3fr] lg:items-stretch">
        <div>
          <SectionHeading
            eyebrow="О компании"
            title="AYPROM — гидравлика для тягачей, самосвалов и спецтехники"
            description="Когда ломается гидравлика, техника простаивает, а простой стоит денег. Мы быстро подбираем совместимую деталь — от одного насоса до готового комплекта — и отправляем её из наличия или под заказ по Кыргызстану и странам СНГ."
          />

          <div className="mt-6 flex flex-col divide-y divide-border">
            {values.map(({ icon: Icon, title, description }) => (
              <div key={title} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <Icon className="h-4 w-4" />
                </span>
                <div>
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

        {/* The truck is now the dominant visual (not a corner decoration
            peeking off a contact card), so it lives inside this panel rather
            than bleeding past it — no viewport-relative clipping math needed. */}
        <div className="relative hidden min-h-[360px] overflow-hidden rounded-2xl border border-border-accent bg-accent/50 lg:block">
          <Image
            src="/about-samosval.png"
            alt="Самосвал"
            width={612}
            height={408}
            sizes="480px"
            className="pointer-events-none absolute inset-x-0 bottom-0 mx-auto w-[78%] max-w-[440px] drop-shadow-xl"
          />

          <div className="absolute inset-x-4 top-4 z-10 flex flex-col gap-4 rounded-xl border border-border-accent bg-card/95 p-4 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <Image
                src="/brand/ayprom-icon.svg"
                alt=""
                width={102}
                height={90}
                className="h-9 w-auto shrink-0 rounded-lg object-contain"
                unoptimized
              />
              <div>
                <p className="text-sm font-semibold text-card-foreground">AYPROM</p>
                <p className="text-xs text-muted-foreground">Бишкек, Кыргызстан</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-3">
              {infoRows.map(({ icon: Icon, label, value, href }) => {
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
                  <a key={label} href={href} className="group flex items-start gap-2">
                    {content}
                  </a>
                ) : (
                  <div key={label} className="flex items-start gap-2">
                    {content}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Mobile/tablet: the panel above is hidden, so contacts get their
            own plain block instead of disappearing entirely below lg. */}
        <div className="rounded-2xl border border-border-accent bg-accent/50 p-6 lg:hidden">
          <div className="flex items-center gap-3">
            <Image
              src="/brand/ayprom-icon.svg"
              alt=""
              width={102}
              height={90}
              className="h-11 w-auto shrink-0 rounded-xl object-contain"
              unoptimized
            />
            <div>
              <p className="text-sm font-semibold text-card-foreground">AYPROM</p>
              <p className="text-xs text-muted-foreground">Бишкек, Кыргызстан</p>
            </div>
          </div>

          <div className="mt-4 flex flex-col divide-y divide-border-accent">
            {infoRows.map(({ icon: Icon, label, value, href }) => {
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
