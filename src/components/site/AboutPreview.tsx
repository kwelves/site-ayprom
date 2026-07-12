import { Eye, LayoutGrid, Package, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";

interface ValueCard {
  icon: LucideIcon;
  title: string;
  description: string;
}

const values: ValueCard[] = [
  {
    icon: LayoutGrid,
    title: "Каталог по категориям",
    description: "Товары разделены по типам деталей и брендам техники.",
  },
  {
    icon: SlidersHorizontal,
    title: "Удобный подбор",
    description: "Поиск и фильтры помогают быстрее найти нужную позицию.",
  },
  {
    icon: Eye,
    title: "Визуальная подача",
    description: "Фото, описание и примерная цена помогают оценить товар до обращения.",
  },
];

interface Stat {
  value: string;
  label: string;
}

const stats: Stat[] = [
  { value: "10k+", label: "позиций в перспективе" },
  { value: "2 типа поиска", label: "по бренду и категории" },
  { value: "24/7", label: "доступ к каталогу" },
];

export function AboutPreview() {
  return (
    <section id="about" className="scroll-mt-16 py-14 sm:py-16">
      <Container className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-stretch">
        <div>
          <SectionHeading
            eyebrow="О компании"
            title="AYPROM — гидрооборудование для спецтехники"
            description="Мы специализируемся на гидрооборудовании и запчастях для грузовой и специальной техники и собираем каталог, чтобы клиентам было проще подобрать нужную позицию по бренду, категории или названию."
          />

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {values.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-blue-200 hover:bg-accent/40"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <Icon className="h-4 w-4" />
                </span>
                <p className="mt-3 text-sm font-semibold text-card-foreground">{title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col justify-between gap-6 rounded-2xl border border-blue-100 bg-accent/50 p-6">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Package className="h-5 w-5" />
          </span>

          <div className="grid grid-cols-3 gap-3 lg:grid-cols-1">
            {stats.map(({ value, label }) => (
              <div key={label}>
                <p className="text-lg font-bold text-card-foreground sm:text-xl">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
