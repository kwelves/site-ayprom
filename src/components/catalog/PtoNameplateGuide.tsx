import { Info } from "lucide-react";
import { Reveal } from "@/components/motion/Reveal";
import { ImageFallback } from "@/components/ui/ImageFallback";

const EXAMPLE_MODELS = [
  "Модель КПП ZF 16 S 151 (указана в строке MODEL) используется в основном на автомобилях марок MAN, DAF, Renault",
  "Модель КПП Renault B181 0L42 (указана в строке TYPE) используется на автомобилях марки Renault",
];

const EXAMPLE_PHOTOS = [
  { src: "/pto-nameplates/example-zf.jpg", alt: "Табличка КПП ZF Friedrichshafen с моделью 16 S 151" },
  { src: "/pto-nameplates/example-renault.jpg", alt: "Табличка КПП Renault Véhicules Industriels с типом B181 0L42" },
];

// Показывается только под товарами категории "Коробки отбора мощности"
// (product.category === "pto") — подбор КОМ единственное место в каталоге,
// где модель КПП тягача решает, подойдёт ли товар, поэтому раздел не
// дублируется на страницах остальных категорий.
export function PtoNameplateGuide() {
  return (
    <Reveal>
      <section
        aria-labelledby="pto-nameplate-guide-title"
        className="mt-16 rounded-2xl border border-border-accent bg-accent/40 p-6 sm:p-8"
      >
        <div className="flex items-center gap-3">
          <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-strong text-accent-foreground">
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-full bg-accent-strong animate-attention-pulse"
            />
            <Info aria-hidden="true" className="relative h-5 w-5" />
          </span>
          <h2
            id="pto-nameplate-guide-title"
            className="border-r-2 border-primary pr-4 text-lg font-bold uppercase tracking-wide text-foreground"
          >
            Внимание
          </h2>
        </div>

        <p className="mt-6 text-base font-semibold text-foreground sm:text-lg">
          При заказе/подборе коробки отбора мощности, пожалуйста, укажите модель КПП вашего грузового автомобиля.
        </p>

        <p className="mt-4 font-semibold text-foreground">
          Модель КПП можно считать с металлической таблички, размещённой на КПП.
        </p>

        <div className="mt-4 text-sm text-muted-foreground">
          <p>Например:</p>
          <ul className="mt-1 space-y-1.5">
            {EXAMPLE_MODELS.map((model) => (
              <li key={model}>{model}</li>
            ))}
          </ul>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4">
          {EXAMPLE_PHOTOS.map((photo) => (
            <div
              key={photo.src}
              className="relative aspect-5/3 overflow-hidden rounded-xl border border-border-accent bg-card"
            >
              <ImageFallback
                src={photo.src}
                alt={photo.alt}
                sizes="(max-width: 639px) 50vw, 25vw"
                className="object-cover"
              />
            </div>
          ))}
        </div>
      </section>
    </Reveal>
  );
}
