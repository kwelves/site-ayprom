import Link from "next/link";
import { ArrowRight, ChevronDown, MessageCircle, Phone } from "lucide-react";
import { CatalogPageShell } from "@/components/catalog/CatalogPageShell";
import { ProductCard } from "@/components/catalog/ProductCard";
import { HoverBorderGrid } from "@/components/motion/HoverBorderGrid";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { CARD_FRAME_CLASSNAME, CARD_GRID_GAP_CLASSNAME } from "@/lib/card-system";
import { NSH_HUB_PAGE, NSH_HUB_PATH, NSH_VEHICLE_PAGES, type NshLandingPage } from "@/lib/nsh-landing";
import { getProductHref } from "@/lib/product-href";
import { getDirectProductCategorySlugs } from "@/lib/queries/categories";
import { getCategoryBrandSlugs } from "@/lib/queries/category-brands";
import { getProducts } from "@/lib/queries/products";
import { cn } from "@/lib/utils";

const PHONE_HREF = "tel:+996500461155";
const WHATSAPP_HREF = "https://wa.me/996500461155";
const VEHICLE_PAGE_PRODUCT_LIMIT = 8;
const gridClassName = cn("grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4", CARD_GRID_GAP_CLASSNAME);

const CHECKLIST = [
  "Марка и модель техники: самосвал, тонар или кран-манипулятор.",
  "Коробка передач и коробка отбора мощности, если она уже стоит.",
  "Маркировка на старом насосе: модель и рабочий объём.",
  "Направление вращения: левое или правое.",
  "Посадка: НШ, ISO или UNI. Если посадка не совпадает, поможет адаптер.",
];

function Heading({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{children}</h2>;
}

function ContactButtons() {
  return (
    <div className="mt-6 flex flex-wrap gap-3">
      <Button href={PHONE_HREF} size="lg">
        <Phone className="h-5 w-5" aria-hidden="true" />
        +996 500 461 155
      </Button>
      <Button href={WHATSAPP_HREF} size="lg" variant="secondary">
        <MessageCircle className="h-5 w-5" aria-hidden="true" />
        Написать в WhatsApp
      </Button>
    </div>
  );
}

// Посадочная страница под поисковые запросы «НШ насос…». Весь текст виден посетителю и лежит в HTML, а список насосов
// берётся из каталога, поэтому цены, наличие и ссылки всегда те же, что в каталоге.
export async function NshLanding({ page }: { page: NshLandingPage }) {
  const isHub = page.path === NSH_HUB_PATH;
  const [pumps, adapters, categoryBrandSlugs, directProductCategorySlugs] = await Promise.all([
    // "шестер" finds both spellings in names: «шестеренчатый» and «шестерённый».
    getProducts({ query: "шестер" }),
    isHub ? getProducts({ query: "адаптер нш" }) : Promise.resolve(null),
    getCategoryBrandSlugs(),
    getDirectProductCategorySlugs(),
  ]);
  const shownPumps = isHub ? pumps.items : pumps.items.slice(0, VEHICLE_PAGE_PRODUCT_LIMIT);
  const hrefFor = (item: Parameters<typeof getProductHref>[0]) => getProductHref(item, categoryBrandSlugs, directProductCategorySlugs);
  const crumbs = isHub
    ? [{ label: NSH_HUB_PAGE.crumb }]
    : [{ label: NSH_HUB_PAGE.crumb, href: NSH_HUB_PATH }, { label: page.crumb }];
  const otherVehiclePages = NSH_VEHICLE_PAGES.filter((item) => item.path !== page.path);

  return (
    <CatalogPageShell canonicalPath={page.path} items={crumbs}>
      <SectionHeading as="h1" eyebrow={page.eyebrow} title={page.h1} className="max-w-3xl" />

      <div className="mt-6 max-w-3xl space-y-4 text-muted-foreground">
        {page.intro.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      <ContactButtons />

      <section className="mt-14" aria-labelledby="nsh-products">
        <Heading id="nsh-products">{isHub ? "НШ насосы в каталоге" : "Шестерённые насосы в каталоге"}</Heading>
        {shownPumps.length > 0 ? (
          <HoverBorderGrid className="mt-6">
            <div className={gridClassName}>
              {shownPumps.map((item) => (
                <ProductCard key={item.slug} product={item} href={hrefFor(item)} />
              ))}
            </div>
          </HoverBorderGrid>
        ) : (
          <p className="mt-4 text-muted-foreground">
            Список насосов обновляется. Посмотрите{" "}
            <Link href="/catalog/category/hydraulic-pumps" className="text-primary underline-offset-4 hover:underline">
              гидронасосы в каталоге
            </Link>{" "}
            или позвоните нам: подберём насос под вашу технику.
          </p>
        )}
        {!isHub && pumps.items.length > VEHICLE_PAGE_PRODUCT_LIMIT && (
          <p className="mt-6">
            <Link href={NSH_HUB_PATH} className="inline-flex items-center gap-2 font-medium text-primary underline-offset-4 hover:underline">
              Все НШ насосы
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </p>
        )}
        {adapters && adapters.items.length > 0 && (
          <div className="mt-12">
            <h3 className="text-lg font-semibold text-foreground">Адаптеры НШ-ISO</h3>
            <HoverBorderGrid className="mt-5">
              <div className={gridClassName}>
                {adapters.items.map((item) => (
                  <ProductCard key={item.slug} product={item} href={hrefFor(item)} />
                ))}
              </div>
            </HoverBorderGrid>
          </div>
        )}
      </section>

      <section className="mt-14 max-w-3xl" aria-labelledby="nsh-usage">
        <Heading id="nsh-usage">{page.usage.heading}</Heading>
        <div className="mt-4 space-y-4 text-muted-foreground">
          {page.usage.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        {isHub ? (
          <ul className="mt-6 grid gap-3 sm:grid-cols-3">
            {NSH_VEHICLE_PAGES.map((item) => (
              <li key={item.path}>
                <Link
                  href={item.path}
                  className={cn(CARD_FRAME_CLASSNAME, "flex h-full items-center justify-between gap-3 px-4 py-4 font-medium text-foreground transition-colors duration-fast ease-ui hover:border-primary hover:text-primary")}
                >
                  {item.h1}
                  <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          page.vehicleTypeSlug && (
            <p className="mt-6">
              <Link
                href={`/catalog/vehicle-type/${page.vehicleTypeSlug}`}
                className="inline-flex items-center gap-2 font-medium text-primary underline-offset-4 hover:underline"
              >
                Всё оборудование для этой техники
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </p>
          )
        )}
      </section>

      {isHub && (
        <section className="mt-14 max-w-3xl" aria-labelledby="nsh-checklist">
          <Heading id="nsh-checklist">Что нужно знать для подбора НШ насоса</Heading>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-muted-foreground marker:font-semibold marker:text-foreground">
            {CHECKLIST.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
          <p className="mt-4 text-muted-foreground">
            Если часть данных неизвестна, позвоните или напишите в WhatsApp: менеджер поможет разобраться.
          </p>
        </section>
      )}

      <section className="mt-14 max-w-3xl" aria-labelledby="nsh-faq">
        <Heading id="nsh-faq">Частые вопросы</Heading>
        <div className="mt-4 divide-y divide-border rounded-xl border border-card-edge bg-card">
          {page.faq.map((item) => (
            <details key={item.question} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-foreground [&::-webkit-details-marker]:hidden">
                {item.question}
                <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-fast ease-ui group-open:rotate-180" aria-hidden="true" />
              </summary>
              <p className="mt-3 text-muted-foreground">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      {!isHub && (
        <nav className="mt-14 max-w-3xl" aria-label="Другие страницы про НШ насосы">
          <h2 className="text-lg font-semibold text-foreground">Подбор на другую технику</h2>
          <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            <li>
              <Link href={NSH_HUB_PATH} className="text-primary underline-offset-4 hover:underline">
                {NSH_HUB_PAGE.h1}
              </Link>
            </li>
            {otherVehiclePages.map((item) => (
              <li key={item.path}>
                <Link href={item.path} className="text-primary underline-offset-4 hover:underline">
                  {item.h1}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <section className="mt-14 max-w-3xl rounded-xl border border-card-edge bg-card p-6 sm:p-8">
        <h2 className="text-xl font-bold tracking-tight text-foreground">Подберём насос под вашу технику</h2>
        <p className="mt-3 text-muted-foreground">
          г. Бишкек, пр. Дэн Сяопина, 457/1. Пн–Сб, 09:00–18:00, воскресенье выходной. Назовите модель техники, и менеджер
          подберёт насос.
        </p>
        <ContactButtons />
      </section>
    </CatalogPageShell>
  );
}
