import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/motion/Reveal";
import { StaggerGroup, StaggerItem } from "@/components/motion/Stagger";

const partners = ["ТехСнаб", "СпецМаш", "ДорТехника", "АгроПром", "ГрузСервис", "ТрансКом"];

export function PartnersSection() {
  return (
    <section className="border-y border-border bg-background py-10">
      <Container>
        <Reveal>
          <p className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Нам доверяют
          </p>
        </Reveal>
        <StaggerGroup className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {partners.map((partner) => (
            <StaggerItem key={partner} hover>
              <div className="flex h-16 items-center justify-center rounded-lg border border-border bg-muted px-3 text-sm font-semibold text-slate-400 grayscale transition hover:grayscale-0 hover:text-slate-600">
                {partner}
              </div>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </Container>
    </section>
  );
}
