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
  // When set, the whole card becomes a single tappable <a> (phone/email —
  // one clear action, and a full card is a much easier mobile tap target
  // than a thin line of text). Cards with no single action, or more than
  // one link (Соцсети), stay a plain <div> and use `content` instead.
  href?: string;
  value?: string;
  content?: React.ReactNode;
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
    href: "tel:+996500461155",
    value: "+996 500 461 155",
  },
  {
    icon: Phone,
    label: "Доп. телефон",
    href: "tel:+996707170696",
    value: "+996 707 17 06 96",
  },
  {
    icon: Mail,
    label: "Email",
    href: "mailto:info@ayprom.kg",
    value: "info@ayprom.kg",
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

function ContactCardBody({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        <Icon className="h-5 w-5" />
      </span>
      <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm font-medium text-card-foreground">{children}</div>
    </>
  );
}

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
        {contactCards.map((card) => (
          <StaggerItem key={card.label}>
            {card.href ? (
              <a
                href={card.href}
                className="block h-full rounded-xl border border-border bg-card p-5 transition-colors hover:border-blue-300"
              >
                <ContactCardBody icon={card.icon} label={card.label}>
                  {card.value}
                </ContactCardBody>
              </a>
            ) : (
              <div className="h-full rounded-xl border border-border bg-card p-5">
                <ContactCardBody icon={card.icon} label={card.label}>
                  {card.content}
                </ContactCardBody>
              </div>
            )}
          </StaggerItem>
        ))}
      </StaggerGroup>
    </Container>
  );
}
