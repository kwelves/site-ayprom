import type { Metadata } from "next";
import { MapPin, Phone, Mail, AtSign, Truck, type LucideIcon } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/motion/Reveal";
import { StaggerGroup, StaggerItem } from "@/components/motion/Stagger";

export const metadata: Metadata = {
  title: "Контакты — AYPROM",
  description: "Адрес, телефоны и соцсети AYPROM в Бишкеке — гидравлика для тягачей, самосвалов и спецтехники.",
};

interface ContactCard {
  icon: LucideIcon;
  label: string;
  content: React.ReactNode;
}

const linkClassName = "text-card-foreground transition-colors hover:text-primary";

const contactCards: ContactCard[] = [
  {
    icon: MapPin,
    label: "Адрес",
    content: <p className="text-card-foreground">г. Бишкек, пр. Дэн Сяопина, 457/1</p>,
  },
  {
    icon: Phone,
    label: "Телефон",
    content: (
      <a href="tel:+996500461155" className={linkClassName}>
        +996 500 461 155
      </a>
    ),
  },
  {
    icon: Phone,
    label: "Доп. телефон",
    content: (
      <a href="tel:+996707170696" className={linkClassName}>
        +996 707 17 06 96
      </a>
    ),
  },
  {
    icon: Mail,
    label: "Email",
    content: (
      <a href="mailto:info@ayprom.kg" className={linkClassName}>
        info@ayprom.kg
      </a>
    ),
  },
  {
    icon: AtSign,
    label: "Соцсети",
    content: (
      <span className="flex flex-wrap gap-x-2 gap-y-1">
        <a href="https://instagram.com/ayprom.kg" target="_blank" rel="noopener noreferrer" className={linkClassName}>
          Instagram
        </a>
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        <a href="https://tiktok.com/@ayprom.kg" target="_blank" rel="noopener noreferrer" className={linkClassName}>
          TikTok
        </a>
      </span>
    ),
  },
  {
    icon: Truck,
    label: "География поставок",
    content: <p className="text-card-foreground">Кыргызстан и страны СНГ</p>,
  },
];

export default function ContactsPage() {
  return (
    <Container className="py-16 sm:py-24">
      <Reveal>
        <SectionHeading
          className="mx-auto text-center"
          eyebrow="Контакты"
          title="Свяжитесь с AYPROM"
          description="Мы на связи по телефону и в Instagram, а если удобнее — заезжайте в Бишкеке по адресу ниже."
        />
      </Reveal>

      <StaggerGroup className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {contactCards.map(({ icon: Icon, label, content }) => (
          <StaggerItem key={label}>
            <div className="h-full rounded-xl border border-border bg-card p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                <Icon className="h-5 w-5" />
              </span>
              <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
              <div className="mt-1 text-sm font-medium">{content}</div>
            </div>
          </StaggerItem>
        ))}
      </StaggerGroup>
    </Container>
  );
}
